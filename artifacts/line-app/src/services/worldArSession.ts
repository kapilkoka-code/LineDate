export type WorldArSignal = {
  id: string;
  distanceMeters: number;
  bearingDegrees: number;
  prominence: 'primary' | 'secondary' | 'tertiary';
  isUnlocked: boolean;
};

export type WorldArTrackingState = 'starting' | 'tracking' | 'lost' | 'ended';

export type WorldArDiagnostics = {
  trackingState: WorldArTrackingState;
  confidence: 'unavailable' | 'low' | 'high';
  cameraPosition: { x: number; y: number; z: number } | null;
  cameraOrientation: { x: number; y: number; z: number; w: number } | null;
  primaryAnchorPosition: { x: number; y: number; z: number } | null;
  anchorState: 'pending' | 'fixed-local-reference' | 'ended';
  referenceSpace: 'local-floor' | 'local' | 'unavailable';
  trackingLosses: number;
  framesPerSecond: number | null;
};

export type WorldArEndReason = 'user' | 'tracking-lost' | 'backgrounded' | 'system';

export type WorldArController = {
  end: (reason?: WorldArEndReason) => Promise<void>;
  reposition?: (headingDegrees: number) => void;
  setActive?: () => void;
};

type XRReferenceSpaceLike = object;

type XRPoseTransformLike = {
  position: { x: number; y: number; z: number };
  orientation: { x: number; y: number; z: number; w: number };
  inverse: { matrix: Float32Array };
};

type XRViewLike = {
  projectionMatrix: Float32Array;
  transform: XRPoseTransformLike;
};

type XRViewerPoseLike = {
  transform: XRPoseTransformLike;
  views: XRViewLike[];
  emulatedPosition?: boolean;
};

type XRFrameLike = {
  getViewerPose: (referenceSpace: XRReferenceSpaceLike) => XRViewerPoseLike | null;
};

type XRViewportLike = { x: number; y: number; width: number; height: number };

type XRWebGLLayerLike = {
  framebuffer: WebGLFramebuffer | null;
  getViewport: (view: XRViewLike) => XRViewportLike | null;
};

type XRSessionLike = {
  renderState: { baseLayer?: XRWebGLLayerLike };
  requestReferenceSpace: (kind: 'local-floor' | 'local') => Promise<XRReferenceSpaceLike>;
  requestAnimationFrame: (callback: (time: number, frame: XRFrameLike) => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
  updateRenderState: (state: { baseLayer: XRWebGLLayerLike }) => void;
  addEventListener: (name: 'end', callback: () => void, options?: AddEventListenerOptions) => void;
  end: () => Promise<void>;
};

type XRSystemLike = {
  requestSession: (
    mode: 'immersive-ar',
    options: {
      requiredFeatures: string[];
      optionalFeatures: string[];
      domOverlay: { root: HTMLElement };
    },
  ) => Promise<XRSessionLike>;
};

type XRWebGLLayerConstructor = new (
  session: XRSessionLike,
  context: WebGLRenderingContext,
  options: { alpha: boolean; antialias: boolean },
) => XRWebGLLayerLike;

type XRWindow = Window & typeof globalThis & {
  XRWebGLLayer?: XRWebGLLayerConstructor;
};

type XRWebGLContext = WebGLRenderingContext & {
  makeXRCompatible?: () => Promise<void>;
};

type StartWorldArOptions = {
  overlayRoot: HTMLElement;
  headingDegrees: number;
  signals: WorldArSignal[];
  onControllerReady: (controller: WorldArController) => void;
  onDiagnostics: (diagnostics: WorldArDiagnostics) => void;
  onEnded: (reason: WorldArEndReason) => void;
};

const TRACKING_LOSS_FALLBACK_MS = 1_800;
const DIAGNOSTIC_INTERVAL_MS = 250;

function normalizeSignedDegrees(value: number) {
  return ((value + 540) % 360) - 180;
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create the world-light shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'Unknown shader compilation error.';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, `
    attribute vec3 aPosition;
    attribute vec4 aColor;
    uniform mat4 uProjection;
    uniform mat4 uView;
    varying lowp vec4 vColor;

    void main() {
      gl_Position = uProjection * uView * vec4(aPosition, 1.0);
      vColor = aColor;
    }
  `);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    varying lowp vec4 vColor;

    void main() {
      gl_FragColor = vColor;
    }
  `);
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to create the world-light program.');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? 'Unknown shader link error.';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function pushVertex(
  vertices: number[],
  x: number,
  y: number,
  z: number,
  alpha: number,
) {
  vertices.push(x, y, z, 0.953, 0.361, 0.31, alpha);
}

function pushVerticalQuad({
  vertices,
  centerX,
  centerZ,
  halfWidth,
  height,
  baseY,
  axis,
  bottomAlpha,
  topAlpha,
}: {
  vertices: number[];
  centerX: number;
  centerZ: number;
  halfWidth: number;
  height: number;
  baseY: number;
  axis: 'x' | 'z';
  bottomAlpha: number;
  topAlpha: number;
}) {
  const firstX = axis === 'x' ? centerX - halfWidth : centerX;
  const firstZ = axis === 'z' ? centerZ - halfWidth : centerZ;
  const secondX = axis === 'x' ? centerX + halfWidth : centerX;
  const secondZ = axis === 'z' ? centerZ + halfWidth : centerZ;

  pushVertex(vertices, firstX, baseY, firstZ, bottomAlpha);
  pushVertex(vertices, secondX, baseY, secondZ, bottomAlpha);
  pushVertex(vertices, secondX, baseY + height, secondZ, topAlpha);
  pushVertex(vertices, firstX, baseY, firstZ, bottomAlpha);
  pushVertex(vertices, secondX, baseY + height, secondZ, topAlpha);
  pushVertex(vertices, firstX, baseY + height, firstZ, topAlpha);
}

function calculateWorldAnchorPosition(
  signal: WorldArSignal,
  headingDegrees: number,
  viewerYawDegrees: number,
  viewerPosition: { x: number; z: number },
  baseY: number,
) {
  const relativeDegrees = normalizeSignedDegrees(signal.bearingDegrees - headingDegrees);
  const angle = (viewerYawDegrees + relativeDegrees) * Math.PI / 180;
  const distance = Math.max(2, Math.min(100, signal.distanceMeters));

  return {
    x: viewerPosition.x + Math.sin(angle) * distance,
    y: baseY,
    z: viewerPosition.z - Math.cos(angle) * distance,
    angle,
    distance,
  };
}

function buildWorldLightGeometry(
  signals: WorldArSignal[],
  headingDegrees: number,
  viewerYawDegrees: number,
  viewerPosition: { x: number; z: number },
  baseY: number,
) {
  const vertices: number[] = [];

  for (const signal of signals.slice(0, 3)) {
    const anchor = calculateWorldAnchorPosition(
      signal,
      headingDegrees,
      viewerYawDegrees,
      viewerPosition,
      baseY,
    );
    const { angle, distance } = anchor;
    const anchorX = anchor.x;
    const anchorZ = anchor.z;
    const perpendicularX = Math.cos(angle);
    const perpendicularZ = Math.sin(angle);
    const separation = 1.05 + distance * 0.005;
    const height = 18 + Math.min(18, distance * 0.18);
    const prominence = signal.prominence === 'primary'
      ? 1
      : signal.prominence === 'secondary'
        ? 0.42
        : 0.24;
    const unlockBoost = signal.isUnlocked ? 1.18 : 1;

    for (const side of [-0.5, 0.5]) {
      const centerX = anchorX + perpendicularX * separation * side;
      const centerZ = anchorZ + perpendicularZ * separation * side;

      for (const axis of ['x', 'z'] as const) {
        pushVerticalQuad({
          vertices,
          centerX,
          centerZ,
          halfWidth: 0.65,
          height,
          baseY,
          axis,
          bottomAlpha: 0.075 * prominence,
          topAlpha: 0.006 * prominence,
        });
        pushVerticalQuad({
          vertices,
          centerX,
          centerZ,
          halfWidth: 0.14 * unlockBoost,
          height,
          baseY,
          axis,
          bottomAlpha: 0.72 * prominence,
          topAlpha: 0.035 * prominence,
        });
      }
    }
  }

  return new Float32Array(vertices);
}

function viewerYawDegreesFromOrientation(
  orientation: { x: number; y: number; z: number; w: number },
) {
  const forwardX = -2 * (orientation.x * orientation.z + orientation.w * orientation.y);
  const forwardZ = -(1 - 2 * (orientation.x ** 2 + orientation.y ** 2));
  return Math.atan2(forwardX, -forwardZ) * 180 / Math.PI;
}

export async function startWorldArSession({
  overlayRoot,
  headingDegrees,
  signals,
  onControllerReady,
  onDiagnostics,
  onEnded,
}: StartWorldArOptions): Promise<WorldArController> {
  const xr = (navigator as Navigator & { xr?: XRSystemLike }).xr;
  const Layer = (window as XRWindow).XRWebGLLayer;
  if (!xr || !Layer) throw new Error('World view is not available on this device.');
  if (signals.length === 0) throw new Error('No nearby light is available to anchor.');

  const session = await xr.requestSession('immersive-ar', {
    requiredFeatures: ['dom-overlay'],
    optionalFeatures: ['local-floor', 'anchors', 'light-estimation'],
    domOverlay: { root: overlayRoot },
  });

  const canvas = document.createElement('canvas');
  canvas.className = 'line-world-ar-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  overlayRoot.append(canvas);

  let gl: XRWebGLContext | null = null;
  let program: WebGLProgram | null = null;
  let vertexBuffer: WebGLBuffer | null = null;
  let animationHandle: number | null = null;
  let ended = false;
  let ending = false;
  let endPromise: Promise<void> | null = null;
  let ready = false;
  let endReason: WorldArEndReason = 'system';
  let activeSignals = signals;
  let referenceSpaceKind: WorldArDiagnostics['referenceSpace'] = 'unavailable';
  let pendingHeadingDegrees: number | null = null;
  let lastDiagnosticAt = 0;
  let framesInWindow = 0;
  let frameWindowStartedAt = 0;
  let framesPerSecond: number | null = null;
  let trackingLostAt: number | null = null;
  let trackingLosses = 0;
  let trackingState: WorldArTrackingState = 'starting';
  let anchorReady = false;
  let primaryAnchorPosition: WorldArDiagnostics['primaryAnchorPosition'] = null;

  const emitDiagnostics = (
    cameraPosition: WorldArDiagnostics['cameraPosition'],
    cameraOrientation: WorldArDiagnostics['cameraOrientation'],
  ) => {
    onDiagnostics({
      trackingState,
      confidence: trackingState === 'tracking' ? 'high' : trackingState === 'lost' ? 'low' : 'unavailable',
      cameraPosition,
      cameraOrientation,
      primaryAnchorPosition,
      anchorState: ended ? 'ended' : anchorReady ? 'fixed-local-reference' : 'pending',
      referenceSpace: referenceSpaceKind,
      trackingLosses,
      framesPerSecond,
    });
  };

  const cleanup = () => {
    if (ended) return;
    ended = true;
    trackingState = 'ended';
    if (animationHandle !== null) session.cancelAnimationFrame?.(animationHandle);
    if (gl && vertexBuffer) gl.deleteBuffer(vertexBuffer);
    if (gl && program) gl.deleteProgram(program);
    canvas.remove();
    emitDiagnostics(null, null);
    if (ready) onEnded(endReason);
  };

  session.addEventListener('end', cleanup, { once: true });

  const requestEnd = (reason: WorldArEndReason) => {
    if (ended) return Promise.resolve();
    if (endPromise) return endPromise;
    ending = true;
    endReason = reason;
    endPromise = session.end().catch(() => {
      cleanup();
    });
    return endPromise;
  };

  const controller: WorldArController = {
    end: (reason = 'user') => requestEnd(reason),
    reposition: (newHeadingDegrees: number) => {
      pendingHeadingDegrees = newHeadingDegrees;
    },
    setActive: () => {
      activeSignals = activeSignals.map((signal) => ({ ...signal, isUnlocked: true }));
      pendingHeadingDegrees = headingDegrees;
    },
  };
  try {
    onControllerReady(controller);
    if (ending || ended) throw new Error('World view was cancelled before setup completed.');
    gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
    }) as XRWebGLContext | null;
    if (!gl) throw new Error('World-light rendering is not available.');
    await gl.makeXRCompatible?.();

    const layer = new Layer(session, gl, { alpha: true, antialias: true });
    session.updateRenderState({ baseLayer: layer });

    let referenceSpace: XRReferenceSpaceLike;
    try {
      referenceSpace = await session.requestReferenceSpace('local-floor');
      referenceSpaceKind = 'local-floor';
    } catch {
      referenceSpace = await session.requestReferenceSpace('local');
      referenceSpaceKind = 'local';
    }

    program = createProgram(gl);
    vertexBuffer = gl.createBuffer();
    if (!vertexBuffer) throw new Error('Unable to allocate world-light geometry.');
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);

    const positionLocation = gl.getAttribLocation(program, 'aPosition');
    const colorLocation = gl.getAttribLocation(program, 'aColor');
    const projectionLocation = gl.getUniformLocation(program, 'uProjection');
    const viewLocation = gl.getUniformLocation(program, 'uView');
    if (positionLocation < 0 || colorLocation < 0 || !projectionLocation || !viewLocation) {
      throw new Error('World-light shader bindings are unavailable.');
    }

    gl.useProgram(program);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 7 * 4, 0);
    gl.enableVertexAttribArray(colorLocation);
    gl.vertexAttribPointer(colorLocation, 4, gl.FLOAT, false, 7 * 4, 3 * 4);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.clearColor(0, 0, 0, 0);
    let geometry: Float32Array | null = null;

    const drawFrame = (time: number, frame: XRFrameLike) => {
      if (ended || ending || !gl || !program) return;
      animationHandle = session.requestAnimationFrame(drawFrame);
      const pose = frame.getViewerPose(referenceSpace);

      if (!pose || pose.emulatedPosition === true) {
        if (trackingLostAt === null) {
          trackingLostAt = time;
          trackingLosses += 1;
          trackingState = 'lost';
          emitDiagnostics(null, null);
        } else if (time - trackingLostAt >= TRACKING_LOSS_FALLBACK_MS) {
          void requestEnd('tracking-lost');
        }
        return;
      }

      trackingLostAt = null;
      trackingState = 'tracking';
      if (!geometry || pendingHeadingDegrees !== null) {
        if (pendingHeadingDegrees !== null) {
          headingDegrees = pendingHeadingDegrees;
          pendingHeadingDegrees = null;
        }
        const viewerPosition = {
          x: pose.transform.position.x,
          z: pose.transform.position.z,
        };
        const baseY = referenceSpaceKind === 'local-floor'
          ? 0
          : pose.transform.position.y - 1.5;
        const viewerYawDegrees = viewerYawDegreesFromOrientation(pose.transform.orientation);
        geometry = buildWorldLightGeometry(
          activeSignals,
          headingDegrees,
          viewerYawDegrees,
          viewerPosition,
          baseY,
        );
        const primarySignal = activeSignals[0];
        primaryAnchorPosition = primarySignal
          ? calculateWorldAnchorPosition(
              primarySignal,
              headingDegrees,
              viewerYawDegrees,
              viewerPosition,
              baseY,
            )
          : null;
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, geometry, gl.STATIC_DRAW);
        anchorReady = true;
      }
      if (frameWindowStartedAt === 0) frameWindowStartedAt = time;
      framesInWindow += 1;
      const frameWindowDuration = time - frameWindowStartedAt;
      if (frameWindowDuration >= 1_000) {
        framesPerSecond = framesInWindow * 1_000 / frameWindowDuration;
        frameWindowStartedAt = time;
        framesInWindow = 0;
      }

      const baseLayer = session.renderState.baseLayer;
      if (!baseLayer) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, baseLayer.framebuffer);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);

      for (const view of pose.views) {
        const viewport = baseLayer.getViewport(view);
        if (!viewport) continue;
        gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
        gl.uniformMatrix4fv(projectionLocation, false, view.projectionMatrix);
        gl.uniformMatrix4fv(viewLocation, false, view.transform.inverse.matrix);
        gl.drawArrays(gl.TRIANGLES, 0, geometry.length / 7);
      }

      if (time - lastDiagnosticAt >= DIAGNOSTIC_INTERVAL_MS) {
        lastDiagnosticAt = time;
        emitDiagnostics(
          {
            x: pose.transform.position.x,
            y: pose.transform.position.y,
            z: pose.transform.position.z,
          },
          {
            x: pose.transform.orientation.x,
            y: pose.transform.orientation.y,
            z: pose.transform.orientation.z,
            w: pose.transform.orientation.w,
          },
        );
      }
    };

    emitDiagnostics(null, null);
    animationHandle = session.requestAnimationFrame(drawFrame);
    ready = true;
    if (ended) throw new Error('World view ended before tracking could begin.');
  } catch (error) {
    await requestEnd(ending ? endReason : 'system');
    cleanup();
    throw error;
  }

  return controller;
}