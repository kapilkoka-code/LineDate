import { Camera, Compass, RefreshCw, ScanLine, Volume2, VolumeX } from 'lucide-react';
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
import { ApiError, api } from '@/services/api';
import {
  disposeFindAudio,
  getFindAudioDiagnostics,
  initializeFindAudio,
  playFindSound,
  setFindAudioEnabled,
  suspendFindAudio,
  updateFindAudioScene,
  type FindAudioDiagnostics,
} from '@/services/findSound';
import { getSpatialLineMetrics } from '@/services/spatialLine';
import {
  startWorldArSession,
  type WorldArController,
  type WorldArDiagnostics,
  type WorldArEndReason,
} from '@/spatial/adapters/webxr';

type CameraState = 'prompt' | 'requesting' | 'granted' | 'denied' | 'simulated';
type CameraFailure = {
  kind: 'permission' | 'missing' | 'busy' | 'playback' | 'unsupported' | 'unknown';
  title: string;
  message: string;
};

type CameraViewProps = {
  location: LocationState;
  nearbyLetters: NearbyLetter[];
  targetLetterId?: string | null;
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
const SIMULATED_BEARINGS = [0, 45, 90, 180, 270, 315] as const;
const SIMULATED_HEADINGS = [0, 45, 90, 180, 270, 315] as const;
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

function describeCameraFailure(error: unknown): CameraFailure {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      kind: 'permission',
      title: 'CAMERA PERMISSION NEEDED',
      message: 'Allow camera access in your browser settings, then try again. Map discovery is still available.',
    };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return {
      kind: 'missing',
      title: 'NO CAMERA FOUND',
      message: 'This device does not expose a camera to the browser. Continue with map discovery.',
    };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return {
      kind: 'busy',
      title: 'CAMERA IS BUSY',
      message: 'Another app may be using the camera. Close it, then try again.',
    };
  }
  if (name === 'NotSupportedError') {
    return {
      kind: 'unsupported',
      title: 'CAMERA NOT SUPPORTED',
      message: 'This browser cannot start a live camera view. Continue with map discovery.',
    };
  }
  if (name === 'CameraPlaybackError') {
    return {
      kind: 'playback',
      title: 'CAMERA COULD NOT START',
      message: 'The camera opened but the live view did not begin. Try again or continue with the map.',
    };
  }
  return {
    kind: 'unknown',
    title: 'CAMERA UNAVAILABLE',
    message: 'The live camera view could not start. Try again or continue with map discovery.',
  };
}

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
  targetLetterId,
  loading,
  networkError,
  onRefresh,
  onNavigateHome,
}: CameraViewProps) {
  const [cameraState, setCameraState] = useState<CameraState>('prompt');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraFailure, setCameraFailure] = useState<CameraFailure | null>(null);
  const [manualHeading, setManualHeading] = useState(0);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === 'visible');
  const [isNight, setIsNight] = useState(() => {
    const hour = new Date().getHours();
    return hour < 6 || hour >= 18;
  });
  const [selectedLetterId, setSelectedLetterId] = useState<string | null>(null);
  const [openedLetter, setOpenedLetter] = useState<NearbyLetter | null>(null);
  const [proximityCheckError, setProximityCheckError] = useState<string | null>(null);
  const [checkingProximity, setCheckingProximity] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [simulatedDistance, setSimulatedDistance] = useState<(typeof SIMULATED_DISTANCES)[number]>(50);
  const [simulatedBearing, setSimulatedBearing] = useState<number>(0);
  const [simulatedHeading, setSimulatedHeading] = useState<number>(0);
  const [showTestControls, setShowTestControls] = useState(false);
  const [simulatedMultipleSignals, setSimulatedMultipleSignals] = useState(false);
  const [simulatedConfidence, setSimulatedConfidence] = useState<SensorConfidence>('high');
  const [simulatedAudioUnavailable, setSimulatedAudioUnavailable] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(() => {
    try {
      return localStorage.getItem('line-find-audio') !== 'off';
    } catch {
      return true;
    }
  });
  const [audioDiagnostics, setAudioDiagnostics] = useState<FindAudioDiagnostics>(() => getFindAudioDiagnostics());
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
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
  const audioSceneRequestRef = useRef(0);
  const cameraRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const dragRef = useRef<{ pointerId: number; startX: number; startYaw: number } | null>(null);
  const lastUnlockedIdRef = useRef<string | null>(null);
  const lastProximityLevelRef = useRef(0);

  const selectedLetter = useMemo(
    () => openedLetter?.id === selectedLetterId
      ? openedLetter
      : nearbyLetters.find((letter) => letter.id === selectedLetterId) ?? null,
    [nearbyLetters, openedLetter, selectedLetterId],
  );

  const prioritizedLetters = useMemo(
    () => (targetLetterId
      ? nearbyLetters.filter((letter) => letter.id === targetLetterId)
      : [...nearbyLetters]
      .sort((first, second) => {
        if (first.isUnlocked !== second.isUnlocked) return first.isUnlocked ? -1 : 1;
        return first.distanceMeters - second.distanceMeters;
      }))
      .slice(0, 3),
    [nearbyLetters, targetLetterId],
  );

  const visualSignals = useMemo<VisualSignal[]>(() => {
    if (cameraState === 'simulated') {
      const source = prioritizedLetters[0] ?? null;
      const primary: VisualSignal = {
        id: source?.id ?? 'development-test',
        source,
        distanceMeters: simulatedDistance,
        bearingDegrees: simulatedBearing,
        // Simulation changes presentation only. Authorization always comes
        // from the real server response for a real nearby letter.
        isUnlocked: source?.isUnlocked === true,
      };
      if (!simulatedMultipleSignals) return [primary];
      return [
        primary,
        {
          id: 'development-test-secondary',
          source: null,
          distanceMeters: Math.min(100, simulatedDistance + 18),
          bearingDegrees: normalizeDegrees(simulatedBearing + 45),
          isUnlocked: false,
        },
        {
          id: 'development-test-tertiary',
          source: null,
          distanceMeters: Math.min(100, simulatedDistance + 36),
          bearingDegrees: normalizeDegrees(simulatedBearing - 70),
          isUnlocked: false,
        },
      ];
    }

    return prioritizedLetters.map((letter) => ({
      id: letter.id,
      source: letter,
      distanceMeters: letter.distanceMeters,
      bearingDegrees: letter.bearingDegrees,
      isUnlocked: letter.isUnlocked,
    }));
  }, [
    cameraState,
    prioritizedLetters,
    simulatedBearing,
    simulatedDistance,
    simulatedMultipleSignals,
  ]);

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
    ? simulatedConfidence
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
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraFailure({
        kind: 'unsupported',
        title: 'CAMERA NOT SUPPORTED',
        message: 'This browser cannot start a live camera view. Continue with map discovery.',
      });
      return 'denied' as const;
    }
    const requestId = cameraRequestRef.current + 1;
    cameraRequestRef.current = requestId;
    setCameraReady(false);
    setCameraFailure(null);

    let stream: MediaStream | null = null;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { exact: 'environment' } },
          audio: false,
        });
      } catch (error) {
        const errorName = error instanceof DOMException || error instanceof Error ? error.name : '';
        const canRetryWithPreferredCamera = errorName === 'OverconstrainedError'
          || errorName === 'ConstraintNotSatisfiedError'
          || errorName === 'NotFoundError'
          || error instanceof TypeError;
        if (!canRetryWithPreferredCamera) throw error;
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
      }

      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack || videoTrack.readyState !== 'live') {
        throw new DOMException('No live video track was returned.', 'NotReadableError');
      }
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
        void videoRef.current.play().catch((error) => {
          if (cameraRequestRef.current !== requestId) return;
          setCameraFailure(describeCameraFailure(
            new DOMException(
              error instanceof Error ? error.message : 'The live view did not begin.',
              'CameraPlaybackError',
            ),
          ));
          setCameraReady(false);
          setCameraState('denied');
          stopCamera();
        });
      }
      return 'granted' as const;
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (cameraRequestRef.current !== requestId) return 'cancelled' as const;
      setCameraFailure(describeCameraFailure(error));
      return 'denied' as const;
    }
  }, [releaseCurrentStream, stopCamera]);

  const failCameraPlayback = useCallback((message?: string) => {
    if (!mountedRef.current) return;
    setCameraFailure(describeCameraFailure(
      new DOMException(message ?? 'The live view did not begin.', 'CameraPlaybackError'),
    ));
    setCameraReady(false);
    setCameraState('denied');
    stopCamera();
  }, [stopCamera]);

  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (!node || !streamRef.current) return;
    node.srcObject = streamRef.current;
    void node.play()
      .then(() => {
        if (!node.paused && node.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          setCameraReady(true);
        }
      })
      .catch((error) => failCameraPlayback(error instanceof Error ? error.message : undefined));
  }, [failCameraPlayback]);

  const startExperience = useCallback(async () => {
    setCameraState('requesting');
    setCameraReady(false);
    setCameraFailure(null);
    if (!location.location) onRefresh();
    void orientation.requestPermission().catch(() => undefined);
    const audioRequest = audioEnabled
      ? initializeFindAudio().then(() => playFindSound('startup'))
      : Promise.resolve();
    void audioRequest.catch(() => undefined);

    stopCamera();
    const cameraResult = await acquireCamera();
    if (!mountedRef.current) return;
    if (cameraResult === 'granted') setCameraState('granted');
    else if (cameraResult === 'denied') setCameraState('denied');
    else setCameraState('prompt');
  }, [acquireCamera, audioEnabled, location.location, onRefresh, orientation, stopCamera]);

  const startDevelopmentMode = useCallback(() => {
    setCameraState('simulated');
    if (audioEnabled) {
      void initializeFindAudio().then((nextDiagnostics) => {
        if (DEVELOPMENT_MODE) setAudioDiagnostics(nextDiagnostics);
        playFindSound('startup');
      });
    }
  }, [audioEnabled]);

  const toggleFindAudio = useCallback(() => {
    const nextEnabled = !audioEnabled;
    setAudioEnabled(nextEnabled);
    if (nextEnabled) {
      void initializeFindAudio().then((nextDiagnostics) => {
        if (DEVELOPMENT_MODE) setAudioDiagnostics(nextDiagnostics);
      });
    }
  }, [audioEnabled]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      worldArRequestRef.current += 1;
      audioSceneRequestRef.current += 1;
      void worldArControllerRef.current?.end('system');
      worldArControllerRef.current = null;
      stopCamera();
      void disposeFindAudio();
    };
  }, [stopCamera]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = () => setReducedMotion(media.matches);
    media.addEventListener?.('change', handleChange);
    return () => media.removeEventListener?.('change', handleChange);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('line-find-audio', audioEnabled ? 'on' : 'off');
    } catch {
      // Audio preference remains session-local when storage is unavailable.
    }
    const nextDiagnostics = setFindAudioEnabled(audioEnabled);
    if (DEVELOPMENT_MODE) setAudioDiagnostics(nextDiagnostics);
  }, [audioEnabled]);

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
    if (cameraState !== 'granted' || cameraReady || !cameraViewVisible) return;
    const timeout = window.setTimeout(() => {
      const video = videoRef.current;
      if (
        !video
        || video.paused
        || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
        || video.videoWidth === 0
        || video.videoHeight === 0
      ) {
        failCameraPlayback();
      }
    }, 8_000);
    return () => window.clearTimeout(timeout);
  }, [cameraReady, cameraState, cameraViewVisible, failCameraPlayback]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible';
      setPageVisible(visible);
      if (!visible) {
        audioSceneRequestRef.current += 1;
        void suspendFindAudio();
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
      audioSceneRequestRef.current += 1;
      void suspendFindAudio();
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
    const requestId = audioSceneRequestRef.current + 1;
    audioSceneRequestRef.current = requestId;
    const sceneActive = audioEnabled
      && pageVisible
      && selectedLetter === null
      && !replyOpen
      && !worldArStarting
      && (cameraState === 'granted' || cameraState === 'simulated')
      && visualSignals.length > 0;
    const audioConfidence = worldArActive ? 'unavailable' : directionalConfidence;
    const scene = {
      active: sceneActive,
      confidence: audioConfidence,
      reducedMotion,
      simulateUnavailable: DEVELOPMENT_MODE && simulatedAudioUnavailable,
      signals: visualSignals.map((signal, index) => ({
        id: signal.id,
        distanceMeters: signal.distanceMeters,
        angularDifference: signedAngleDifference(signal.bearingDegrees, visualHeading),
        prominence: index === 0 ? 'primary' as const : index === 1 ? 'secondary' as const : 'tertiary' as const,
        isUnlocked: signal.isUnlocked,
      })),
    };

    if (!sceneActive) {
      const nextDiagnostics = updateFindAudioScene(scene);
      if (DEVELOPMENT_MODE) setAudioDiagnostics(nextDiagnostics);
      void suspendFindAudio();
      return;
    }

    void initializeFindAudio()
      .then(() => {
        if (
          !mountedRef.current
          || audioSceneRequestRef.current !== requestId
          || document.visibilityState !== 'visible'
        ) return;
        const nextDiagnostics = updateFindAudioScene(scene);
        if (DEVELOPMENT_MODE) setAudioDiagnostics(nextDiagnostics);
      })
      .catch(() => undefined);
    return () => {
      if (audioSceneRequestRef.current === requestId) audioSceneRequestRef.current += 1;
    };
  }, [
    audioEnabled,
    cameraState,
    directionalConfidence,
    pageVisible,
    reducedMotion,
    replyOpen,
    selectedLetter,
    simulatedAudioUnavailable,
    visualHeading,
    visualSignals,
    worldArActive,
    worldArStarting,
  ]);

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

  const checkProximity = useCallback(async (letter: NearbyLetter) => {
    if (!location.location || checkingProximity) return;
    setCheckingProximity(true);
    setProximityCheckError(null);
    try {
      const unlocked = await api.letter(letter.id, location.location);
      const opened: NearbyLetter = {
        ...letter,
        id: unlocked.id,
        distanceMeters: unlocked.distanceMeters ?? letter.distanceMeters,
        distanceLabel: `${Math.max(1, Math.round(unlocked.distanceMeters ?? letter.distanceMeters))}m`,
        isUnlocked: true,
        letter: {
          ...letter.letter,
          id: unlocked.id,
          text: unlocked.text ?? '',
          isUnlocked: true,
        },
      };
      setOpenedLetter(opened);
      setSelectedLetterId(opened.id);
    } catch (error) {
      setProximityCheckError(
        error instanceof ApiError && error.status === 403
          ? 'Not within 10m yet. Keep following the light.'
          : 'This signal is no longer available.',
      );
    } finally {
      setCheckingProximity(false);
    }
  }, [checkingProximity, location.location]);

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
          onClose={() => {
            setOpenedLetter(null);
            setSelectedLetterId(null);
          }}
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
              onClick={startDevelopmentMode}
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
          <span className="line-section-index line-mono">{cameraFailure?.title ?? 'CAMERA UNAVAILABLE'}</span>
          <h1 className="line-serif">The signal is still there.</h1>
          <p>{cameraFailure?.message ?? 'Camera access is needed for FIND. You can continue with map discovery.'}</p>
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
              onClick={startDevelopmentMode}
            >
              Development test mode
            </button>
          )}
        </div>
      </div>
    );
  }

  const locationUnavailable = location.status !== 'active' || !location.location;
  const targetUnavailable = Boolean(
    targetLetterId
    && !loading
    && nearbyLetters.every((letter) => letter.id !== targetLetterId),
  );
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
      : !targetLetterId
        ? ['CHOOSE A SIGNAL', 'Open God’s Eye View and select a LINE to find.']
      : targetUnavailable
        ? ['SIGNAL FADED', 'This LINE is no longer in the active field.']
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
    : cameraState === 'granted' && !cameraReady
      ? ['PREPARING CAMERA', 'Starting the live view…']
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
        <video
          ref={attachVideo}
          autoPlay
          playsInline
          muted
          className="line-camera-video"
          aria-label="Live camera view"
          onPlaying={() => setCameraReady(true)}
          onError={() => failCameraPlayback(videoRef.current?.error?.message)}
        />
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

        {proximityCheckError && (
          <div className="line-find-calibration" role="status">
            <span className="line-mono">{proximityCheckError}</span>
          </div>
        )}

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
              onOpen={signal.source ? () => void checkProximity(signal.source!) : undefined}
            />
          );
        })}

        {!worldArActive && <div className="line-camera-crosshair" aria-hidden="true" />}

        <div className="line-find-controls">
          {primarySignal?.source && targetLetterId && (
            <button
              type="button"
              className="line-find-world-ar line-mono"
              onClick={() => void checkProximity(primarySignal.source!)}
              disabled={checkingProximity}
              data-testid="button-check-line-proximity"
            >
              {checkingProximity ? 'Checking…' : 'Check proximity'}
            </button>
          )}
          <button
            type="button"
            className="line-find-audio-toggle line-mono"
            onClick={toggleFindAudio}
            aria-pressed={audioEnabled}
            data-testid="button-toggle-find-audio"
          >
            {audioEnabled ? <Volume2 size={13} aria-hidden="true" /> : <VolumeX size={13} aria-hidden="true" />}
            Audio {audioEnabled ? 'on' : 'off'}
          </button>
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
              <span className="line-mono">Confidence</span>
              {(['high', 'medium', 'low', 'unavailable'] as const).map((confidence) => (
                <button
                  type="button"
                  key={confidence}
                  onClick={() => setSimulatedConfidence(confidence)}
                  aria-pressed={simulatedConfidence === confidence}
                >
                  {confidence}
                </button>
              ))}
            </div>
            <div>
              <span className="line-mono">Audio scene</span>
              <button
                type="button"
                onClick={() => setSimulatedMultipleSignals((current) => !current)}
                aria-pressed={simulatedMultipleSignals}
              >
                {simulatedMultipleSignals ? '3 signals' : '1 signal'}
              </button>
              <button
                type="button"
                onClick={() => setSimulatedAudioUnavailable((current) => !current)}
                aria-pressed={simulatedAudioUnavailable}
              >
                {simulatedAudioUnavailable ? 'Audio unavailable' : 'Audio available'}
              </button>
              <button type="button" onClick={() => playFindSound('unlock')}>
                Preview found bloom
              </button>
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
              <div><dt>Audio enabled</dt><dd>{audioDiagnostics.enabled ? 'YES' : 'NO'}</dd></div>
              <div><dt>Audio capability</dt><dd>{audioDiagnostics.capability.toUpperCase()}</dd></div>
              <div><dt>Audio lifecycle</dt><dd>{audioDiagnostics.lifecycle.toUpperCase()}</dd></div>
              <div><dt>Audio delta / pan</dt><dd>{audioDiagnostics.angularDifference === null ? '—' : `${Math.round(audioDiagnostics.angularDifference)}° / ${audioDiagnostics.pan.toFixed(2)}`}</dd></div>
              <div><dt>Audio distance / level</dt><dd>{audioDiagnostics.distanceMeters === null ? '—' : `${Math.round(audioDiagnostics.distanceMeters)}m / ${(audioDiagnostics.intensity * 100).toFixed(0)}%`}</dd></div>
              <div><dt>Audio confidence / voices</dt><dd>{audioDiagnostics.confidence.toUpperCase()} / {audioDiagnostics.activeVoices}</dd></div>
            </dl>
            <p>Visual and audio simulation only. Server access remains locked.</p>
          </aside>
        )}
      </div>
    </div>
  );
}