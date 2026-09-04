import { Camera, Compass, RefreshCw, ScanLine } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { CinematicLine } from '@/components/line/CinematicLine';
import { LetterReader } from '@/components/line/DiscoveryField';
import { LineMark } from '@/components/line/LineMark';
import { ReplyComposer } from '@/components/line/ReplyComposer';
import type { LocationState } from '@/hooks/useLocation';
import { useArCapability } from '@/hooks/useArCapability';
import {
  normalizeDegrees,
  signedAngleDifference,
  useOrientationController,
  type SensorConfidence,
} from '@/hooks/useOrientationController';
import type { NearbyLetter } from '@/services/discovery';
import { playFindSound } from '@/services/findSound';
import { getSpatialLineMetrics } from '@/services/spatialLine';
import {
  startWorldArSession,
  type WorldArController,
  type WorldArDiagnostics,
  type WorldArEndReason,
} from '@/services/worldArSession';

type CameraState = 'prompt' | 'requesting' | 'granted' | 'denied' | 'simulated';

type CameraViewProps = {
  location: LocationState;
  nearbyLetters: NearbyLetter[];
  loading: boolean;
  networkError: string | null;
  onRefresh: () => void;
  onNavigateHome: () => void;
};

type VisualSignal = {
  id: string;
  source: NearbyLetter | null;
  distanceMeters: number;
  bearingDegrees: number;
  isUnlocked: boolean;
};

const DEVELOPMENT_MODE = import.meta.env.DEV;
const FIND_REFRESH_INTERVAL_MS = 15_000;
const SIMULATED_DISTANCES = [100, 50, 20, 10, 5] as const;
const SIMULATED_BEARINGS = [0, 90, 180, 270] as const;
const SIMULATED_HEADINGS = [0, 90, 180, 270] as const;
const INITIAL_AR_DIAGNOSTICS: WorldArDiagnostics = {
  trackingState: 'ended',
  confidence: 'unavailable',
  cameraPosition: null,
  cameraOrientation: null,
  anchorState: 'ended',
  referenceSpace: 'unavailable',
  trackingLosses: 0,
  framesPerSecond: null,
};

function signalIntensity(distanceMeters: number, isUnlocked: boolean) {
  if (isUnlocked) return 1;
  if (distanceMeters <= 10) return 0.92;
  if (distanceMeters <= 15) return 0.78;
  if (distanceMeters <= 20) return 0.62;
  if (distanceMeters <= 30) return 0.4;
  if (distanceMeters <= 50) return 0.2;
  return Math.max(0.1, (100 - distanceMeters) / 500);
}

function triggerHaptic(level: 'approaching' | 'near' | 'unlocked') {
  if (!navigator.vibrate) return;
  if (level === 'approaching') navigator.vibrate(8);
  if (level === 'near') navigator.vibrate(18);
  if (level === 'unlocked') navigator.vibrate(35);
}

export function CameraView({
  location,
  nearbyLetters,
  loading,
  networkError,
  onRefresh,
  onNavigateHome,
}: CameraViewProps) {
  const [cameraState, setCameraState] = useState<CameraState>('prompt');
  const [manualHeading, setManualHeading] = useState(0);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === 'visible');
  const [isNight, setIsNight] = useState(() => {
    const hour = new Date().getHours();
    return hour < 6 || hour >= 18;
  });
  const [selectedLetterId, setSelectedLetterId] = useState<string | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [simulatedDistance, setSimulatedDistance] = useState<(typeof SIMULATED_DISTANCES)[number]>(50);
  const [simulatedBearing, setSimulatedBearing] = useState<number>(0);
  const [simulatedHeading, setSimulatedHeading] = useState<number>(0);
  const [showTestControls, setShowTestControls] = useState(false);
  const [pulseLetterId, setPulseLetterId] = useState<string | null>(null);
  const [worldArActive, setWorldArActive] = useState(false);
  const [worldArStarting, setWorldArStarting] = useState(false);
  const [worldArStatus, setWorldArStatus] = useState<string | null>(null);
  const [worldArDiagnostics, setWorldArDiagnostics] = useState<WorldArDiagnostics>(INITIAL_AR_DIAGNOSTICS);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraRootRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const worldArControllerRef = useRef<WorldArController | null>(null);
  const worldArRequestRef = useRef(0);
  const cameraRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const dragRef = useRef<{ pointerId: number; startX: number; startYaw: number } | null>(null);
  const lastUnlockedIdRef = useRef<string | null>(null);
  const lastProximityLevelRef = useRef(0);

  const selectedLetter = useMemo(
    () => nearbyLetters.find((letter) => letter.id === selectedLetterId) ?? null,
    [nearbyLetters, selectedLetterId],
  );

  const prioritizedLetters = useMemo(
    () => [...nearbyLetters]
      .sort((first, second) => {
        if (first.isUnlocked !== second.isUnlocked) return first.isUnlocked ? -1 : 1;
        return first.distanceMeters - second.distanceMeters;
      })
      .slice(0, 3),
    [nearbyLetters],
  );

  const visualSignals = useMemo<VisualSignal[]>(() => {
    if (cameraState === 'simulated') {
      const source = prioritizedLetters[0] ?? null;
      return [{
        id: source?.id ?? 'development-test',
        source,
        distanceMeters: simulatedDistance,
        bearingDegrees: simulatedBearing,
        // Simulation changes presentation only. Authorization always comes
        // from the real server response for a real nearby letter.
        isUnlocked: source?.isUnlocked === true,
      }];
    }

    return prioritizedLetters.map((letter) => ({
      id: letter.id,
      source: letter,
      distanceMeters: letter.distanceMeters,
      bearingDegrees: letter.bearingDegrees,
      isUnlocked: letter.isUnlocked,
    }));
  }, [cameraState, prioritizedLetters, simulatedBearing, simulatedDistance]);

  const primarySignal = visualSignals[0] ?? null;
  const gpsDirectionUncertain = Boolean(
    primarySignal
    && location.location
    && location.location.accuracy > Math.max(35, primarySignal.distanceMeters * 1.25),
  );
  const cameraViewVisible = pageVisible
    && selectedLetter === null
    && !worldArActive
    && !worldArStarting;
  const orientation = useOrientationController({
    active: cameraState === 'granted' && cameraViewVisible,
    gpsAccuracy: location.location?.accuracy ?? null,
    locationTimestamp: location.location?.timestamp ?? null,
    distanceMeters: primarySignal?.distanceMeters ?? null,
  });
  const sensorHeadingAvailable = orientation.permission === 'granted'
    && orientation.heading !== null
    && orientation.diagnostics.orientationAvailable;
  const sensorHeading = orientation.heading ?? manualHeading;
  const visualHeading = cameraState === 'simulated'
    ? simulatedHeading
    : sensorHeadingAvailable
      ? sensorHeading
      : manualHeading;
  const directionalConfidence: SensorConfidence = cameraState === 'simulated'
    ? 'high'
    : sensorHeadingAvailable
      ? orientation.confidence
      : 'unavailable';
  const arCapability = useArCapability({
    cameraAvailable: cameraState !== 'denied' && Boolean(navigator.mediaDevices?.getUserMedia),
    trustedHeadingAvailable: sensorHeadingAvailable
      && orientation.confidence === 'high'
      && !gpsDirectionUncertain
      && location.location !== null,
  });

  const releaseCurrentStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stopCamera = useCallback(() => {
    cameraRequestRef.current += 1;
    releaseCurrentStream();
  }, [releaseCurrentStream]);

  const acquireCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return 'denied' as const;
    const requestId = cameraRequestRef.current + 1;
    cameraRequestRef.current = requestId;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      if (
        !mountedRef.current
        || cameraRequestRef.current !== requestId
        || document.visibilityState !== 'visible'
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return 'cancelled' as const;
      }

      releaseCurrentStream();
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => undefined);
      }
      return 'granted' as const;
    } catch {
      return cameraRequestRef.current === requestId ? 'denied' as const : 'cancelled' as const;
    }
  }, [releaseCurrentStream]);

  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (!node || !streamRef.current) return;
    node.srcObject = streamRef.current;
    void node.play().catch(() => undefined);
  }, []);

  const startExperience = useCallback(async () => {
    setCameraState('requesting');
    if (!location.location) onRefresh();
    const orientationRequest = orientation.requestPermission();
    playFindSound('startup');

    stopCamera();
    const [cameraResult] = await Promise.all([acquireCamera(), orientationRequest]);
    if (!mountedRef.current) return;
    if (cameraResult === 'granted') setCameraState('granted');
    else if (cameraResult === 'denied') setCameraState('denied');
    else setCameraState('prompt');
  }, [acquireCamera, location.location, onRefresh, orientation, stopCamera]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      worldArRequestRef.current += 1;
      void worldArControllerRef.current?.end('system');
      worldArControllerRef.current = null;
      stopCamera();
    };
  }, [stopCamera]);

  useEffect(() => {
    const updateAmbientMode = () => {
      const hour = new Date().getHours();
      setIsNight(hour < 6 || hour >= 18);
    };
    const interval = window.setInterval(updateAmbientMode, 5 * 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (worldArActive || worldArStatus !== 'Using directional finding…') return;
    const timeout = window.setTimeout(() => setWorldArStatus(null), 2_800);
    return () => window.clearTimeout(timeout);
  }, [worldArActive, worldArStatus]);

  useEffect(() => {
    if (cameraState !== 'granted' || !cameraViewVisible) return;
    const interval = window.setInterval(onRefresh, FIND_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [cameraState, cameraViewVisible, onRefresh]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible';
      setPageVisible(visible);
      if (!visible) {
        worldArRequestRef.current += 1;
        const controller = worldArControllerRef.current;
        worldArControllerRef.current = null;
        setWorldArActive(false);
        setWorldArStarting(false);
        setWorldArStatus(null);
        setWorldArDiagnostics(INITIAL_AR_DIAGNOSTICS);
        void controller?.end('backgrounded');
        stopCamera();
      }
    };
    const handlePageHide = () => {
      setPageVisible(false);
      worldArRequestRef.current += 1;
      const controller = worldArControllerRef.current;
      worldArControllerRef.current = null;
      setWorldArActive(false);
      setWorldArStarting(false);
      setWorldArStatus(null);
      setWorldArDiagnostics(INITIAL_AR_DIAGNOSTICS);
      void controller?.end('backgrounded');
      stopCamera();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [stopCamera]);

  const restoreDirectionalFinding = useCallback((reason: WorldArEndReason) => {
    worldArControllerRef.current = null;
    if (!mountedRef.current) return;
    setWorldArActive(false);
    setWorldArStarting(false);
    setWorldArDiagnostics(INITIAL_AR_DIAGNOSTICS);
    setWorldArStatus(reason === 'tracking-lost' ? 'Using directional finding…' : null);
    onRefresh();
    void acquireCamera().then((result) => {
      if (mountedRef.current && result === 'denied') setCameraState('denied');
    });
  }, [acquireCamera, onRefresh]);

  const startWorldView = useCallback(async () => {
    const overlayRoot = cameraRootRef.current;
    if (
      !overlayRoot
      || !sensorHeadingAvailable
      || cameraState !== 'granted'
      || visualSignals.length === 0
      || worldArStarting
      || arCapability.state !== 'WORLD_AR_SUPPORTED'
    ) return;

    const requestId = worldArRequestRef.current + 1;
    worldArRequestRef.current = requestId;
    setWorldArStarting(true);
    setWorldArStatus('Calibrating surroundings…');
    stopCamera();

    try {
      const controller = await startWorldArSession({
        overlayRoot,
        headingDegrees: visualHeading,
        signals: visualSignals.map((signal, index) => ({
          id: signal.id,
          distanceMeters: signal.distanceMeters,
          bearingDegrees: signal.bearingDegrees,
          prominence: index === 0 ? 'primary' : index === 1 ? 'secondary' : 'tertiary',
          isUnlocked: signal.isUnlocked,
        })),
        onControllerReady: (pendingController) => {
          if (
            !mountedRef.current
            || worldArRequestRef.current !== requestId
            || document.visibilityState !== 'visible'
          ) {
            void pendingController.end('backgrounded');
            return;
          }
          worldArControllerRef.current = pendingController;
        },
        onDiagnostics: (diagnostics) => {
          if (worldArRequestRef.current === requestId) setWorldArDiagnostics(diagnostics);
        },
        onEnded: (reason) => {
          if (worldArRequestRef.current === requestId) restoreDirectionalFinding(reason);
        },
      });
      if (
        !mountedRef.current
        || worldArRequestRef.current !== requestId
        || document.visibilityState !== 'visible'
      ) {
        await controller.end('system');
        return;
      }
      worldArControllerRef.current = controller;
      setWorldArActive(true);
      setWorldArStatus(null);
    } catch {
      if (!mountedRef.current || worldArRequestRef.current !== requestId) return;
      worldArControllerRef.current = null;
      setWorldArDiagnostics(INITIAL_AR_DIAGNOSTICS);
      setWorldArStatus('Using directional finding…');
      const result = await acquireCamera();
      if (mountedRef.current && result === 'denied') setCameraState('denied');
    } finally {
      if (mountedRef.current && worldArRequestRef.current === requestId) setWorldArStarting(false);
    }
  }, [
    acquireCamera,
    arCapability.state,
    cameraState,
    restoreDirectionalFinding,
    sensorHeadingAvailable,
    stopCamera,
    visualHeading,
    visualSignals,
    worldArStarting,
  ]);

  useEffect(() => {
    if (cameraState !== 'granted') return;
    if (!cameraViewVisible) {
      stopCamera();
      return;
    }
    if (streamRef.current) return;

    let cancelled = false;
    onRefresh();
    void acquireCamera().then((result) => {
      if (!cancelled && result === 'denied') setCameraState('denied');
    });
    return () => {
      cancelled = true;
    };
  }, [acquireCamera, cameraState, cameraViewVisible, onRefresh, stopCamera]);

  useEffect(() => {
    if (selectedLetterId && !selectedLetter) {
      setSelectedLetterId(null);
      setReplyOpen(false);
    }
  }, [selectedLetter, selectedLetterId]);

  useEffect(() => {
    const unlockedId = prioritizedLetters.find((letter) => letter.isUnlocked)?.id ?? null;
    if (unlockedId && unlockedId !== lastUnlockedIdRef.current) {
      lastUnlockedIdRef.current = unlockedId;
      setPulseLetterId(unlockedId);
      triggerHaptic('unlocked');
      playFindSound('unlock');
      const timeout = window.setTimeout(() => setPulseLetterId(null), 2200);
      return () => window.clearTimeout(timeout);
    }
    if (!unlockedId) lastUnlockedIdRef.current = null;
    return undefined;
  }, [prioritizedLetters]);

  useEffect(() => {
    if (!primarySignal) {
      lastProximityLevelRef.current = 0;
      return;
    }
    if (primarySignal.isUnlocked) return;
    const nextLevel = primarySignal.distanceMeters <= 15 ? 2 : primarySignal.distanceMeters <= 30 ? 1 : 0;
    if (nextLevel > lastProximityLevelRef.current) {
      triggerHaptic(nextLevel === 2 ? 'near' : 'approaching');
      playFindSound('approaching');
    }
    lastProximityLevelRef.current = nextLevel;
  }, [primarySignal]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (sensorHeadingAvailable && cameraState !== 'simulated') return;
    if ((event.target as HTMLElement).closest('button')) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startYaw: visualHeading };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextHeading = normalizeDegrees(drag.startYaw - (event.clientX - drag.startX) * 0.45);
    if (cameraState === 'simulated') setSimulatedHeading(nextHeading);
    else setManualHeading(nextHeading);
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  if (selectedLetter && replyOpen) {
    return (
      <div className="line-view line-camera-reply">
        <ReplyComposer
          letter={selectedLetter}
          currentLocation={location.location}
          locationAccuracy={location.location?.accuracy ?? null}
          loading={loading}
          onRefresh={onRefresh}
          onClose={() => setReplyOpen(false)}
        />
      </div>
    );
  }

  if (selectedLetter?.isUnlocked) {
    return (
      <div className="line-view line-camera-reader">
        <LetterReader
          letter={selectedLetter}
          locationAccuracy={location.location?.accuracy ?? null}
          loading={loading}
          onRefresh={onRefresh}
          onReply={() => setReplyOpen(true)}
          onClose={() => setSelectedLetterId(null)}
        />
      </div>
    );
  }

  if (cameraState === 'prompt' || cameraState === 'requesting') {
    return (
      <div className="line-view line-camera-onboarding" data-testid="screen-find-onboarding">
        <header className="line-app-header">
          <LineMark compact />
          <span className="line-header-index line-mono">02 / FIND</span>
        </header>
        <div className="line-find-intro">
          <span className="line-section-index line-mono">CAMERA DISCOVERY</span>
          <h1 className="line-serif">Somewhere around you, someone left a Line.</h1>
          <p>Look around.</p>
        </div>
        <div className="line-camera-actions">
          <button
            type="button"
            className="line-btn-primary line-mono"
            onClick={() => void startExperience()}
            disabled={cameraState === 'requesting'}
            data-testid="button-start-finding"
          >
            <Camera size={16} aria-hidden="true" />
            {cameraState === 'requesting' ? 'Starting camera…' : 'Start finding'}
          </button>
          <button type="button" className="line-btn-secondary line-mono" onClick={onNavigateHome}>
            Use map discovery
          </button>
          {DEVELOPMENT_MODE && (
            <button
              type="button"
              className="line-btn-secondary line-mono"
              onClick={() => {
                setCameraState('simulated');
              }}
              data-testid="button-start-find-test-mode"
            >
              Development test mode
            </button>
          )}
        </div>
      </div>
    );
  }

  if (cameraState === 'denied') {
    return (
      <div className="line-view line-camera-denied" data-testid="screen-find-camera-denied">
        <header className="line-app-header">
          <LineMark compact />
          <span className="line-header-index line-mono">02 / FIND</span>
        </header>
        <div className="line-find-intro">
          <span className="line-section-index line-mono">CAMERA UNAVAILABLE</span>
          <h1 className="line-serif">The signal is still there.</h1>
          <p>Camera access is needed for FIND. You can continue with the existing map.</p>
        </div>
        <div className="line-camera-actions">
          <button type="button" className="line-btn-primary line-mono" onClick={onNavigateHome} data-testid="button-fallback-discover">
            <Compass size={16} aria-hidden="true" />
            Open map discovery
          </button>
          <button type="button" className="line-btn-secondary line-mono" onClick={() => void startExperience()}>
            Try camera again
          </button>
          {DEVELOPMENT_MODE && (
            <button
              type="button"
              className="line-btn-secondary line-mono"
              onClick={() => {
                setCameraState('simulated');
              }}
            >
              Development test mode
            </button>
          )}
        </div>
      </div>
    );
  }

  const locationUnavailable = location.status !== 'active' || !location.location;
  const sensorNeedsCalibration = cameraState === 'granted'
    && sensorHeadingAvailable
    && directionalConfidence === 'low'
    && !gpsDirectionUncertain;
  const primaryVisualIntensity = primarySignal
    ? signalIntensity(primarySignal.distanceMeters, primarySignal.isUnlocked)
    : null;
  const primaryVisualScale = primarySignal && primaryVisualIntensity !== null
    ? getSpatialLineMetrics(
      primarySignal.distanceMeters,
      0.78 + primaryVisualIntensity * 0.3,
      isNight,
    )
    : null;
  const primaryStatus = locationUnavailable
    ? ['LOCATION NEEDED', 'Enable location to discover nearby letters.']
    : networkError
      ? ['SIGNAL INTERRUPTED', 'Nearby letters could not be refreshed.']
      : !primarySignal
        ? ['NOTHING NEARBY', 'Nothing nearby.']
        : primarySignal.isUnlocked
          ? ['YOU FOUND A LINE', 'The light is open.']
          : primarySignal.distanceMeters <= 15
            ? ['VERY NEAR', 'Almost there.']
            : primarySignal.distanceMeters <= 25
              ? ['APPROACHING', 'You’re getting closer.']
              : ['DETECTED', 'Something is nearby.'];
  const visibleStatus = worldArActive
    ? worldArDiagnostics.trackingState !== 'tracking'
      ? ['CALIBRATING', 'Calibrating surroundings…']
      : ['LIGHT ANCHORED', 'The light is fixed around you.']
    : primaryStatus;

  return (
    <div
      ref={cameraRootRef}
      className={`line-camera-active${worldArActive ? ' line-world-ar-active' : ''}`}
      data-testid="screen-find-active"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      {cameraState === 'granted' && !worldArActive ? (
        <video ref={attachVideo} autoPlay playsInline muted className="line-camera-video" aria-label="Live rear camera view" />
      ) : !worldArActive ? (
        <div className="line-camera-simulated-bg" aria-label="Development camera simulation">
          <div className="line-simulated-grid" style={{ backgroundPositionX: `${-visualHeading * 4}px` }} />
        </div>
      ) : null}
      {!worldArActive && <div className="line-camera-vignette" aria-hidden="true" />}

      <div className="line-camera-overlay">
        <header className="line-camera-overlay-header">
          <LineMark compact light />
          <div className="line-camera-status line-mono">
            <span>{worldArActive ? 'WORLD VIEW' : cameraState === 'simulated' ? 'TEST VIEW' : 'LIVE FIND'}</span>
            <span>{worldArActive ? 'LIGHT FIXED IN PLACE' : sensorHeadingAvailable ? 'ORIENTATION ACTIVE' : 'DRAG TO LOOK AROUND'}</span>
          </div>
        </header>

        <div className="line-find-state" role="status" aria-live="polite" data-testid="state-find-discovery">
           <span className="line-mono">{visibleStatus[0]}</span>
           <strong className="line-serif">{visibleStatus[1]}</strong>
          {primarySignal && <small className="line-mono">{Math.max(1, Math.round(primarySignal.distanceMeters))} m away</small>}
        </div>

        {(worldArStatus || gpsDirectionUncertain || sensorNeedsCalibration) && (
          <div className="line-find-calibration" role="status" data-testid="state-find-calibration">
            <span className="line-mono">
              {worldArStatus ?? (gpsDirectionUncertain ? 'Finding a clearer signal…' : 'Calibrating direction…')}
            </span>
            {!worldArStatus && sensorNeedsCalibration && <small>Move your phone slowly in a small circle.</small>}
          </div>
        )}

        {!worldArActive && visualSignals.map((signal, index) => {
          const difference = signedAngleDifference(signal.bearingDegrees, visualHeading);
          const absDiff = Math.abs(difference);
          const beamVisibility = Math.max(0, 1 - Math.max(0, absDiff - 35) / 40);
          const atmosphereVisibility = absDiff <= 35
            ? 1
            : 1 - Math.min(1, (absDiff - 35) / 145) * 0.92;
          const clampedDifference = Math.max(-70, Math.min(70, difference));

          const intensity = signalIntensity(signal.distanceMeters, signal.isUnlocked);
          const secondary = index > 0;
          const tertiary = index > 1;
          const confidenceMovement = directionalConfidence === 'low' ? 0.62 : directionalConfidence === 'medium' ? 0.86 : 1;
          const confidenceOpacity = directionalConfidence === 'low' ? 0.64 : directionalConfidence === 'medium' ? 0.84 : 1;
          const prominenceOpacity = index === 0 ? 1 : index === 1 ? 0.42 : 0.24;
          const prominenceScale = index === 0 ? 1 : index === 1 ? 0.82 : 0.68;
          const beamOpacity = beamVisibility * intensity * confidenceOpacity * prominenceOpacity;
          const atmosphereOpacity = atmosphereVisibility * confidenceOpacity * prominenceOpacity;

          return (
            <CinematicLine
              key={signal.id}
              letterId={signal.id}
              distanceMeters={signal.distanceMeters}
              bearing={signal.bearingDegrees}
              isUnlocked={signal.isUnlocked}
              intensity={intensity}
              beamOpacity={beamOpacity}
              atmosphereOpacity={atmosphereOpacity}
              scale={(0.78 + intensity * 0.3) * prominenceScale}
              horizontalPosition={50 + clampedDifference * 1.2 * confidenceMovement}
              secondary={secondary}
              tertiary={tertiary}
              pulse={signal.id === pulseLetterId}
              confidence={directionalConfidence}
              isNight={isNight}
              onOpen={signal.source?.isUnlocked ? () => setSelectedLetterId(signal.source!.id) : undefined}
            />
          );
        })}

        {!worldArActive && <div className="line-camera-crosshair" aria-hidden="true" />}

        <div className="line-find-controls">
          {locationUnavailable || networkError ? (
            <button type="button" className="line-find-refresh line-mono" onClick={onRefresh} disabled={loading} data-testid="button-refresh-find">
              <RefreshCw size={13} className={loading ? 'line-refresh-spinning' : ''} aria-hidden="true" />
              {locationUnavailable ? 'Enable location' : 'Refresh signals'}
            </button>
          ) : null}
          {worldArActive ? (
            <button
              type="button"
              className="line-find-world-ar line-mono"
              onClick={() => void worldArControllerRef.current?.end('user')}
              data-testid="button-exit-world-ar"
            >
              Exit world view
            </button>
          ) : arCapability.state === 'WORLD_AR_SUPPORTED'
            && cameraState === 'granted'
            && primarySignal ? (
              <button
                type="button"
                className="line-find-world-ar line-mono"
                onClick={() => void startWorldView()}
                disabled={worldArStarting}
                data-testid="button-start-world-ar"
              >
                <ScanLine size={13} aria-hidden="true" />
                {worldArStarting ? 'Calibrating…' : 'Enter world view'}
              </button>
            ) : null}
          {DEVELOPMENT_MODE && cameraState === 'simulated' && (
            <button
              type="button"
              className="line-find-test-toggle line-mono"
              onClick={() => setShowTestControls((visible) => !visible)}
              aria-expanded={showTestControls}
              data-testid="button-toggle-find-test-controls"
            >
              Test controls
            </button>
          )}
        </div>

        {DEVELOPMENT_MODE && cameraState === 'simulated' && showTestControls && (
          <aside className="line-find-test-panel" data-testid="panel-find-test-controls">
            <div>
              <span className="line-mono">Distance</span>
              {SIMULATED_DISTANCES.map((distance) => (
                <button
                  type="button"
                  key={distance}
                  onClick={() => setSimulatedDistance(distance)}
                  aria-pressed={simulatedDistance === distance}
                >
                  {distance}m
                </button>
              ))}
            </div>
            <div>
              <span className="line-mono">Bearing</span>
              {SIMULATED_BEARINGS.map((bearing) => (
                <button
                  type="button"
                  key={bearing}
                  onClick={() => setSimulatedBearing(bearing)}
                  aria-pressed={simulatedBearing === bearing}
                >
                  {bearing}°
                </button>
              ))}
            </div>
            <div>
              <span className="line-mono">User heading</span>
              {SIMULATED_HEADINGS.map((heading) => (
                <button
                  type="button"
                  key={heading}
                  onClick={() => setSimulatedHeading(heading)}
                  aria-pressed={Math.round(simulatedHeading) === heading}
                >
                  {heading}°
                </button>
              ))}
            </div>
            <div>
              <span className="line-mono">Wrap-around</span>
              <button
                type="button"
                onClick={() => {
                  setSimulatedHeading(350);
                  setSimulatedBearing(10);
                }}
                aria-pressed={Math.round(simulatedHeading) === 350 && simulatedBearing === 10}
              >
                350° → 10°
              </button>
              <button
                type="button"
                onClick={() => {
                  setSimulatedHeading(10);
                  setSimulatedBearing(350);
                }}
                aria-pressed={Math.round(simulatedHeading) === 10 && simulatedBearing === 350}
              >
                10° → 350°
              </button>
            </div>
            <dl className="line-find-diagnostics" data-testid="find-sensor-diagnostics">
              <div><dt>Confidence</dt><dd data-confidence={directionalConfidence}>{directionalConfidence.toUpperCase()}</dd></div>
              <div><dt>Heading</dt><dd>{Math.round(visualHeading)}°</dd></div>
              <div><dt>Raw / smooth</dt><dd>{cameraState === 'simulated' ? `${Math.round(simulatedHeading)}° / ${Math.round(simulatedHeading)}°` : `${orientation.diagnostics.rawHeading === null ? '—' : `${Math.round(orientation.diagnostics.rawHeading)}°`} / ${orientation.heading === null ? '—' : `${Math.round(orientation.heading)}°`}`}</dd></div>
              <div><dt>Bearing / delta</dt><dd>{simulatedBearing}° / {Math.round(signedAngleDifference(simulatedBearing, visualHeading))}°</dd></div>
              <div><dt>Intensity / Scale</dt><dd>{primaryVisualIntensity !== null && primaryVisualScale ? `${(primaryVisualIntensity * 100).toFixed(0)}% / ${(primaryVisualScale.scaleX * 100).toFixed(0)}×${(primaryVisualScale.scaleY * 100).toFixed(0)}%` : '—'}</dd></div>
              <div><dt>GPS / age</dt><dd>{location.location ? `±${Math.round(location.location.accuracy)}m / ${Math.round((orientation.locationAgeMs ?? 0) / 1000)}s` : 'Unavailable'}</dd></div>
              <div><dt>Sensors</dt><dd>{orientation.diagnostics.orientationAvailable ? 'Orientation' : 'Touch'} · {orientation.diagnostics.motionAvailable ? 'Motion' : 'No motion'}</dd></div>
              <div><dt>Screen</dt><dd>{orientation.diagnostics.screenOrientation}°</dd></div>
              <div><dt>AR capability</dt><dd>{arCapability.state}</dd></div>
              <div><dt>AR tracking</dt><dd>{worldArDiagnostics.trackingState.toUpperCase()} / {worldArDiagnostics.confidence.toUpperCase()}</dd></div>
              <div><dt>AR pose</dt><dd>{worldArDiagnostics.cameraPosition ? `${worldArDiagnostics.cameraPosition.x.toFixed(2)}, ${worldArDiagnostics.cameraPosition.y.toFixed(2)}, ${worldArDiagnostics.cameraPosition.z.toFixed(2)}` : 'Unavailable'}</dd></div>
              <div><dt>AR rotation</dt><dd>{worldArDiagnostics.cameraOrientation ? `${worldArDiagnostics.cameraOrientation.x.toFixed(2)}, ${worldArDiagnostics.cameraOrientation.y.toFixed(2)}, ${worldArDiagnostics.cameraOrientation.z.toFixed(2)}, ${worldArDiagnostics.cameraOrientation.w.toFixed(2)}` : 'Unavailable'}</dd></div>
              <div><dt>AR anchor</dt><dd>{worldArDiagnostics.anchorState} / {worldArDiagnostics.referenceSpace}</dd></div>
              <div><dt>AR losses / FPS</dt><dd>{worldArDiagnostics.trackingLosses} / {worldArDiagnostics.framesPerSecond?.toFixed(0) ?? '—'}</dd></div>
            </dl>
            <p>Visual simulation only. Server access remains locked.</p>
          </aside>
        )}
      </div>
    </div>
  );
}