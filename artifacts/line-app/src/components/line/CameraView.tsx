import { Camera, Compass, RefreshCw } from 'lucide-react';
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
import type { NearbyLetter } from '@/services/discovery';
import { playFindSound } from '@/services/findSound';

type CameraState = 'prompt' | 'requesting' | 'granted' | 'denied' | 'simulated';
type OrientationState = 'prompt' | 'granted' | 'denied' | 'unsupported';
type DeviceOrientationConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

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

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function signedAngleDifference(target: number, current: number) {
  return ((target - current + 540) % 360) - 180;
}

function signalIntensity(distanceMeters: number, isUnlocked: boolean) {
  if (isUnlocked) return 1;
  if (distanceMeters <= 10) return 0.92;
  if (distanceMeters <= 15) return 0.78;
  if (distanceMeters <= 20) return 0.62;
  if (distanceMeters <= 30) return 0.4;
  if (distanceMeters <= 50) return 0.2;
  return Math.max(0.035, (100 - distanceMeters) / 500);
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
  const [orientationState, setOrientationState] = useState<OrientationState>('prompt');
  const [yaw, setYaw] = useState(0);
  const [selectedLetterId, setSelectedLetterId] = useState<string | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [simulatedDistance, setSimulatedDistance] = useState<(typeof SIMULATED_DISTANCES)[number]>(50);
  const [simulatedBearing, setSimulatedBearing] = useState<(typeof SIMULATED_BEARINGS)[number]>(0);
  const [showTestControls, setShowTestControls] = useState(false);
  const [pulseLetterId, setPulseLetterId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
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

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (!node || !streamRef.current) return;
    node.srcObject = streamRef.current;
    void node.play().catch(() => undefined);
  }, []);

  const requestOrientation = useCallback(async () => {
    if (!('DeviceOrientationEvent' in window)) {
      setOrientationState('unsupported');
      return;
    }

    const OrientationEvent = window.DeviceOrientationEvent as DeviceOrientationConstructor;
    if (typeof OrientationEvent.requestPermission === 'function') {
      try {
        const permission = await OrientationEvent.requestPermission();
        setOrientationState(permission === 'granted' ? 'granted' : 'denied');
      } catch {
        setOrientationState('denied');
      }
      return;
    }

    setOrientationState('granted');
  }, []);

  const startExperience = useCallback(async () => {
    setCameraState('requesting');
    if (!location.location) onRefresh();
    void requestOrientation();
    playFindSound('startup');

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('denied');
      return;
    }

    try {
      stopCamera();
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      setCameraState('granted');
    } catch {
      stopCamera();
      setCameraState('denied');
    }
  }, [location.location, onRefresh, requestOrientation, stopCamera]);

  useEffect(() => stopCamera, [stopCamera]);

  useEffect(() => {
    if (orientationState !== 'granted') return;
    let animationFrame: number | null = null;
    let latestHeading = 0;
    let receivedOrientation = false;
    const handleOrientation = (event: DeviceOrientationEvent) => {
      receivedOrientation = true;
      const compassHeading = (event as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
      latestHeading = compassHeading ?? normalizeDegrees(360 - (event.alpha ?? 0));
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(() => {
        setYaw(latestHeading);
        animationFrame = null;
      });
    };
    const fallbackTimeout = window.setTimeout(() => {
      if (!receivedOrientation) setOrientationState('unsupported');
    }, 1600);
    window.addEventListener('deviceorientation', handleOrientation);
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
      window.clearTimeout(fallbackTimeout);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    };
  }, [orientationState]);

  useEffect(() => {
    if (cameraState !== 'granted') return;
    const interval = window.setInterval(onRefresh, FIND_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [cameraState, onRefresh]);

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
    if (orientationState === 'granted' && cameraState !== 'simulated') return;
    if ((event.target as HTMLElement).closest('button')) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startYaw: yaw };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setYaw(normalizeDegrees(drag.startYaw - (event.clientX - drag.startX) * 0.45));
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
                setOrientationState('unsupported');
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
                setOrientationState('unsupported');
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

  return (
    <div
      className="line-camera-active"
      data-testid="screen-find-active"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      {cameraState === 'granted' ? (
        <video ref={attachVideo} autoPlay playsInline muted className="line-camera-video" aria-label="Live rear camera view" />
      ) : (
        <div className="line-camera-simulated-bg" aria-label="Development camera simulation">
          <div className="line-simulated-grid" style={{ backgroundPositionX: `${-yaw * 4}px` }} />
        </div>
      )}
      <div className="line-camera-vignette" aria-hidden="true" />

      <div className="line-camera-overlay">
        <header className="line-camera-overlay-header">
          <LineMark compact light />
          <div className="line-camera-status line-mono">
            <span>{cameraState === 'simulated' ? 'TEST VIEW' : 'LIVE FIND'}</span>
            <span>{orientationState === 'granted' ? 'ORIENTATION ACTIVE' : 'DRAG TO LOOK AROUND'}</span>
          </div>
        </header>

        <div className="line-find-state" role="status" aria-live="polite" data-testid="state-find-discovery">
          <span className="line-mono">{primaryStatus[0]}</span>
          <strong className="line-serif">{primaryStatus[1]}</strong>
          {primarySignal && <small className="line-mono">{Math.max(1, Math.round(primarySignal.distanceMeters))} m away</small>}
        </div>

        {visualSignals.map((signal, index) => {
          const difference = signedAngleDifference(signal.bearingDegrees, yaw);
          const edgeVisibility = Math.max(0, 1 - Math.max(0, Math.abs(difference) - 38) / 18);
          const intensity = signalIntensity(signal.distanceMeters, signal.isUnlocked);
          const secondary = index > 0;
          return (
            <CinematicLine
              key={signal.id}
              letterId={signal.id}
              distanceMeters={signal.distanceMeters}
              bearing={signal.bearingDegrees}
              isUnlocked={signal.isUnlocked}
              intensity={intensity}
              opacity={edgeVisibility * intensity * (secondary ? 0.42 : 1)}
              scale={(0.78 + intensity * 0.3) * (secondary ? 0.82 : 1)}
              horizontalPosition={50 + difference * 1.05}
              secondary={secondary}
              pulse={signal.id === pulseLetterId}
              onOpen={signal.source?.isUnlocked ? () => setSelectedLetterId(signal.source!.id) : undefined}
            />
          );
        })}

        <div className="line-camera-crosshair" aria-hidden="true" />

        <div className="line-find-controls">
          {locationUnavailable || networkError ? (
            <button type="button" className="line-find-refresh line-mono" onClick={onRefresh} disabled={loading} data-testid="button-refresh-find">
              <RefreshCw size={13} className={loading ? 'line-refresh-spinning' : ''} aria-hidden="true" />
              {locationUnavailable ? 'Enable location' : 'Refresh signals'}
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
            <p>Visual simulation only. Server access remains locked.</p>
          </aside>
        )}
      </div>
    </div>
  );
}