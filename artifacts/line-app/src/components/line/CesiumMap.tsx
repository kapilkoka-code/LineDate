import * as Cesium from 'cesium';
import { useEffect, useRef, useState } from 'react';
import type { LocationData } from '@/hooks/useLocation';
import type { SignalFieldRecord } from '@workspace/api-client-react';
import 'cesium/Build/Cesium/Widgets/widgets.css';

type CesiumMapProps = {
  location: LocationData | null;
  signals: SignalFieldRecord[];
  onSelect: (signalId: string) => void;
  onUnavailable: () => void;
};

const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined;
const ION_ASSET_ID = import.meta.env.VITE_CESIUM_ION_ASSET_ID as string | undefined;

const bands: Record<string, number[]> = { close: [7, 12], local: [20, 48], distant: [58, 96] };
const sectors: Record<string, number> = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 };

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function makeSignalVisuals(signal: SignalFieldRecord, location: LocationData) {
  const hash = hashString(signal.handle);
  const band = bands[signal.distanceBand] || bands.distant;

  const distance = band[0] + (hash % 1000) / 1000 * (band[1] - band[0]);
  const baseAngle = sectors[signal.bearingSector] || 0;
  const angleOffset = -22.5 + ((hash >> 4) % 1000) / 1000 * 45;
  const bearing = (baseAngle + angleOffset) * (Math.PI / 180);

  const north = Math.cos(bearing) * distance;
  const east = Math.sin(bearing) * distance;
  const latitude = location.latitude + north / 111_320;
  const longitudeScale = Math.max(0.01, Math.cos((location.latitude * Math.PI) / 180));
  const longitude = location.longitude + east / (111_320 * longitudeScale);

  return { latitude, longitude, distance };
}

export function CesiumMap({ location, signals, onSelect, onUnavailable }: CesiumMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const creditsRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const youEntityRef = useRef<Cesium.Entity | null>(null);
  const signalEntitiesRef = useRef<Cesium.Entity[]>([]);
  const [initializationError, setInitializationError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const capabilityCanvas = document.createElement('canvas');
    const webgl2 = capabilityCanvas.getContext('webgl2');
    if (!webgl2) {
      setInitializationError('This browser cannot start the 3D view.');
      onUnavailable();
      return;
    }
    webgl2.getExtension('WEBGL_lose_context')?.loseContext();

    let viewer: Cesium.Viewer;
    let removeRenderErrorListener: (() => void) | null = null;
    try {
      if (ION_TOKEN) Cesium.Ion.defaultAccessToken = ION_TOKEN;
      viewer = new Cesium.Viewer(containerRef.current, {
        animation: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        navigationHelpButton: false,
        sceneModePicker: false,
        selectionIndicator: false,
        timeline: false,
        fullscreenButton: false,
        vrButton: false,
        baseLayer: false,
        requestRenderMode: true,
        maximumRenderTimeChange: Infinity,
        creditContainer: creditsRef.current ?? containerRef.current,
        msaaSamples: 1,
        contextOptions: {
          requestWebgl1: false,
          webgl: {
            alpha: false,
            antialias: false,
            failIfMajorPerformanceCaveat: false,
            preserveDrawingBuffer: false,
            powerPreference: 'low-power',
          },
        },
      });
      viewer.targetFrameRate = 30;
      viewer.scene.screenSpaceCameraController.enableTilt = true;
      viewer.scene.screenSpaceCameraController.enableRotate = true;
      viewer.scene.globe.enableLighting = false;
      viewer.scene.globe.showGroundAtmosphere = true;
      viewer.scene.fog.enabled = true;
      viewer.scene.fog.density = 0.0012;
      viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#11100f');
      removeRenderErrorListener = viewer.scene.renderError.addEventListener(() => {
        setInitializationError('The 3D view stopped unexpectedly.');
        onUnavailable();
      });

      const imageryProvider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        credit: new Cesium.Credit('© OpenStreetMap contributors'),
        maximumLevel: 19,
      });
      imageryProvider.errorEvent.addEventListener(() => onUnavailable());
      const imageryLayer = viewer.imageryLayers.addImageryProvider(imageryProvider);
      imageryLayer.brightness = 0.2;
      imageryLayer.saturation = 0.15;
      imageryLayer.contrast = 1.2;

      if (ION_TOKEN && ION_ASSET_ID) {
        void Cesium.Cesium3DTileset.fromIonAssetId(Number(ION_ASSET_ID))
          .then((tileset) => {
            if (!viewer.isDestroyed()) viewer.scene.primitives.add(tileset);
          })
          .catch(() => {
            // The globe remains usable when optional 3D Tiles are unavailable.
          });
      }

      viewer.screenSpaceEventHandler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
        const picked = viewer.scene.pick(movement.position);
        const pickedEntity = picked?.id;
        const pickedId = pickedEntity instanceof Cesium.Entity
          ? pickedEntity.properties?.lineSignalHandle?.getValue(Cesium.JulianDate.now())
          : null;
        if (typeof pickedId === 'string') onSelect(pickedId);
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

      viewerRef.current = viewer;
    } catch (error) {
      setInitializationError(error instanceof Error ? error.message : 'The 3D view could not start.');
      onUnavailable();
    }

    return () => {
      removeRenderErrorListener?.();
      if (viewerRef.current && !viewerRef.current.isDestroyed()) viewerRef.current.destroy();
      viewerRef.current = null;
      youEntityRef.current = null;
      signalEntitiesRef.current = [];
    };
  }, [onSelect, onUnavailable]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !location) return;

    const youPosition = Cesium.Cartesian3.fromDegrees(location.longitude, location.latitude, 12);
    if (!youEntityRef.current) {
      youEntityRef.current = viewer.entities.add({
        position: youPosition,
        point: {
          pixelSize: 6,
          color: Cesium.Color.fromCssColorString('#ffffff').withAlpha(0.9),
          outlineColor: Cesium.Color.fromCssColorString('#f35c4f').withAlpha(0.6),
          outlineWidth: 4,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
        ellipse: {
          semiMinorAxis: 15.0,
          semiMajorAxis: 15.0,
          material: new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString('#f35c4f').withAlpha(0.1)),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#f35c4f').withAlpha(0.3),
        },
      });
    } else {
      youEntityRef.current.position = youPosition as unknown as Cesium.PositionProperty;
    }

    for (const entity of signalEntitiesRef.current) viewer.entities.remove(entity);
    signalEntitiesRef.current = [];

    for (const signal of signals) {
      const visual = makeSignalVisuals(signal, location);

      const beamHeight = signal.distanceBand === 'close' ? 28 : signal.distanceBand === 'local' ? 52 : 82;
      const beamWidth = signal.distanceBand === 'close' ? 0.3 : signal.distanceBand === 'local' ? 0.48 : 0.7;

      const beamColor = '#f35c4f';
      const alpha = signal.hierarchy === 'primary' ? 0.75 : signal.hierarchy === 'secondary' ? 0.45 : 0.25;
      const material = Cesium.Color.fromCssColorString(beamColor).withAlpha(alpha);

      // Create twin vertical beams (left and right)
      const offset = signal.distanceBand === 'close' ? 0.000004 : signal.distanceBand === 'local' ? 0.000007 : 0.00001;

      const leftBeam = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(visual.longitude - offset, visual.latitude, beamHeight / 2),
        properties: { lineSignalHandle: signal.handle },
        cylinder: {
          length: beamHeight,
          topRadius: beamWidth,
          bottomRadius: beamWidth,
          material,
        }
      });
      const rightBeam = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(visual.longitude + offset, visual.latitude, beamHeight / 2),
        properties: { lineSignalHandle: signal.handle },
        cylinder: {
          length: beamHeight,
          topRadius: beamWidth,
          bottomRadius: beamWidth,
          material,
        }
      });

      const basePoint = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(visual.longitude, visual.latitude, 2),
        properties: { lineSignalHandle: signal.handle },
        point: {
          pixelSize: signal.hierarchy === 'primary' ? 6 : 4,
          color: Cesium.Color.fromCssColorString(beamColor).withAlpha(0.9),
          outlineColor: Cesium.Color.fromCssColorString('#f3e9d8').withAlpha(0.5),
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
      });

      signalEntitiesRef.current.push(leftBeam, rightBeam, basePoint);
    }

    viewer.scene.requestRender();
  }, [location, signals]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !location) return;
    const origin = Cesium.Cartesian3.fromDegrees(location.longitude, location.latitude, 0);
    const range = Math.max(150, Math.min(280, location.accuracy * 3));
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      viewer.camera.lookAt(origin, new Cesium.HeadingPitchRange(0.35, -0.72, range));
      return;
    }
    void viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(origin, 1),
      {
        offset: new Cesium.HeadingPitchRange(0.35, -0.72, range),
        duration: 0.8,
      },
    );
  }, [location?.timestamp]);

  return (
    <div className="line-cesium-map" data-testid="cesium-map">
      <div ref={containerRef} className="line-cesium-map-canvas" />
      <div ref={creditsRef} className="line-cesium-credits" aria-label="Map data attribution" />
      <div className="line-cesium-map-topline line-mono">
        <span>LINE / WORLD SIGNALS</span>
        <span>{ION_TOKEN && ION_ASSET_ID ? '3D CITY' : '3D GLOBE'}</span>
      </div>
      {!location && !initializationError && (
        <div className="line-cesium-map-status line-mono">WAITING FOR LOCATION</div>
      )}
      {initializationError && (
        <div className="line-cesium-map-status line-mono" role="status">
          3D VIEW UNAVAILABLE
        </div>
      )}
    </div>
  );
}