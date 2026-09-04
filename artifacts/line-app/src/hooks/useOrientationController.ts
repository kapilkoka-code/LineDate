import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type OrientationPermission = 'prompt' | 'granted' | 'denied' | 'unsupported';
export type SensorConfidence = 'high' | 'medium' | 'low' | 'unavailable';
export type HeadingSource = 'ios-compass' | 'absolute-orientation' | 'relative-orientation' | 'none';

type PermissionAwareEventConstructor = {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

type CompassOrientationEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};

type ConfidenceInput = {
  hasHeading: boolean;
  headingSource: HeadingSource;
  stabilityDegrees: number | null;
  compassAccuracy: number | null;
  gpsAccuracy: number | null;
  locationAgeMs: number | null;
  distanceMeters: number | null;
};

export type OrientationDiagnostics = {
  rawHeading: number | null;
  smoothedHeading: number | null;
  headingSource: HeadingSource;
  stabilityDegrees: number | null;
  compassAccuracy: number | null;
  orientationAvailable: boolean;
  motionAvailable: boolean;
  screenOrientation: number;
};

const HEADING_SAMPLE_LIMIT = 12;
const SENSOR_EVENT_TIMEOUT_MS = 2_000;

export function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

export function signedAngleDifference(target: number, current: number) {
  return ((target - current + 540) % 360) - 180;
}

export function smoothCircularHeading(current: number, target: number, factor: number) {
  return normalizeDegrees(current + signedAngleDifference(target, current) * factor);
}

function getScreenOrientationDegrees() {
  const screenAngle = window.screen.orientation?.angle;
  if (typeof screenAngle === 'number') return normalizeDegrees(screenAngle);
  const legacyAngle = window.orientation;
  return typeof legacyAngle === 'number' ? normalizeDegrees(legacyAngle) : 0;
}

function averageCircularMovement(samples: number[]) {
  if (samples.length < 2) return null;
  let movement = 0;
  for (let index = 1; index < samples.length; index += 1) {
    movement += Math.abs(signedAngleDifference(samples[index], samples[index - 1]));
  }
  return movement / (samples.length - 1);
}

export function getSensorConfidence({
  hasHeading,
  headingSource,
  stabilityDegrees,
  compassAccuracy,
  gpsAccuracy,
  locationAgeMs,
  distanceMeters,
}: ConfidenceInput): SensorConfidence {
  if (!hasHeading) return 'unavailable';

  const uncertainGps = gpsAccuracy !== null
    && distanceMeters !== null
    && gpsAccuracy > Math.max(35, distanceMeters * 1.25);
  if (
    uncertainGps
    || (locationAgeMs !== null && locationAgeMs > 45_000)
    || (stabilityDegrees !== null && stabilityDegrees > 28)
    || (compassAccuracy !== null && compassAccuracy > 60)
  ) {
    return 'low';
  }

  const absoluteSource = headingSource === 'ios-compass' || headingSource === 'absolute-orientation';
  const stable = stabilityDegrees !== null && stabilityDegrees <= 7;
  const accurateCompass = compassAccuracy === null || compassAccuracy <= 25;
  const freshLocation = locationAgeMs === null || locationAgeMs <= 15_000;
  const accurateGps = gpsAccuracy === null || gpsAccuracy <= 20;

  if (absoluteSource && stable && accurateCompass && freshLocation && accurateGps) return 'high';
  return 'medium';
}

export function useOrientationController({
  active,
  gpsAccuracy,
  locationTimestamp,
  distanceMeters,
}: {
  active: boolean;
  gpsAccuracy: number | null;
  locationTimestamp: number | null;
  distanceMeters: number | null;
}) {
  const orientationSupported = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  const motionSupported = typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
  const [permission, setPermission] = useState<OrientationPermission>(
    orientationSupported ? 'prompt' : 'unsupported',
  );
  const [diagnostics, setDiagnostics] = useState<OrientationDiagnostics>({
    rawHeading: null,
    smoothedHeading: null,
    headingSource: 'none',
    stabilityDegrees: null,
    compassAccuracy: null,
    orientationAvailable: false,
    motionAvailable: false,
    screenOrientation: typeof window === 'undefined' ? 0 : getScreenOrientationDegrees(),
  });
  const smoothedHeadingRef = useRef<number | null>(null);
  const samplesRef = useRef<number[]>([]);
  const absoluteEventAtRef = useRef(0);
  const screenOrientationRef = useRef(
    typeof window === 'undefined' ? 0 : getScreenOrientationDegrees(),
  );

  const requestPermission = useCallback(async () => {
    if (!orientationSupported) {
      setPermission('unsupported');
      return 'unsupported' as const;
    }

    const OrientationEvent = window.DeviceOrientationEvent as unknown as PermissionAwareEventConstructor;
    const MotionEvent = window.DeviceMotionEvent as unknown as PermissionAwareEventConstructor | undefined;

    try {
      // Both permission calls are intentionally started before awaiting so iOS
      // sees them as part of the START FINDING user gesture.
      const orientationRequest = typeof OrientationEvent.requestPermission === 'function'
        ? OrientationEvent.requestPermission()
        : Promise.resolve<'granted'>('granted');
      const motionRequest = motionSupported && typeof MotionEvent?.requestPermission === 'function'
        ? MotionEvent.requestPermission()
        : Promise.resolve<'granted'>('granted');
      const [orientationResult] = await Promise.all([orientationRequest, motionRequest]);
      const nextPermission = orientationResult === 'granted' ? 'granted' : 'denied';
      setPermission(nextPermission);
      return nextPermission;
    } catch {
      setPermission('denied');
      return 'denied' as const;
    }
  }, [motionSupported, orientationSupported]);

  useEffect(() => {
    if (!active || permission !== 'granted') return;

    let animationFrame: number | null = null;
    let sensorTimeout: number | null = null;
    let latestSample: {
      rawHeading: number;
      source: HeadingSource;
      compassAccuracy: number | null;
    } | null = null;

    const markSensorUnavailable = () => {
      sensorTimeout = null;
      smoothedHeadingRef.current = null;
      samplesRef.current = [];
      setDiagnostics((current) => ({
        ...current,
        rawHeading: null,
        smoothedHeading: null,
        headingSource: 'none',
        stabilityDegrees: null,
        compassAccuracy: null,
        orientationAvailable: false,
      }));
    };

    const armSensorWatchdog = () => {
      if (sensorTimeout !== null) window.clearTimeout(sensorTimeout);
      sensorTimeout = window.setTimeout(markSensorUnavailable, SENSOR_EVENT_TIMEOUT_MS);
    };

    const commitLatestSample = () => {
      animationFrame = null;
      if (!latestSample) return;

      const { rawHeading, source, compassAccuracy } = latestSample;
      samplesRef.current = [...samplesRef.current.slice(-(HEADING_SAMPLE_LIMIT - 1)), rawHeading];
      const stabilityDegrees = averageCircularMovement(samplesRef.current);
      const previous = smoothedHeadingRef.current;
      const smoothingFactor = stabilityDegrees !== null && stabilityDegrees > 16 ? 0.12 : 0.22;
      const smoothedHeading = previous === null
        ? rawHeading
        : smoothCircularHeading(previous, rawHeading, smoothingFactor);
      smoothedHeadingRef.current = smoothedHeading;

      setDiagnostics((current) => ({
        ...current,
        rawHeading,
        smoothedHeading,
        headingSource: source,
        stabilityDegrees,
        compassAccuracy,
        orientationAvailable: true,
        screenOrientation: getScreenOrientationDegrees(),
      }));
    };

    const handleOrientation = (event: Event) => {
      const orientationEvent = event as CompassOrientationEvent;
      const isAbsoluteEvent = event.type === 'deviceorientationabsolute';
      const now = performance.now();
      if (isAbsoluteEvent) absoluteEventAtRef.current = now;
      if (!isAbsoluteEvent && now - absoluteEventAtRef.current < 800) return;

      const screenOrientation = getScreenOrientationDegrees();
      if (screenOrientation !== screenOrientationRef.current) {
        screenOrientationRef.current = screenOrientation;
        smoothedHeadingRef.current = null;
        samplesRef.current = [];
      }
      const iosCompassHeading = orientationEvent.webkitCompassHeading;
      const alpha = orientationEvent.alpha;
      if (typeof iosCompassHeading !== 'number' && typeof alpha !== 'number') return;
      const earthReferenced = typeof iosCompassHeading === 'number'
        || isAbsoluteEvent
        || orientationEvent.absolute === true;
      if (!earthReferenced) return;

      armSensorWatchdog();
      const baseHeading = typeof iosCompassHeading === 'number'
        ? iosCompassHeading
        : normalizeDegrees(360 - (alpha ?? 0));
      latestSample = {
        // iOS already reports an earth-referenced compass heading. Absolute
        // alpha uses portrait device coordinates and needs screen correction.
        rawHeading: normalizeDegrees(
          typeof iosCompassHeading === 'number'
            ? baseHeading
            : baseHeading + screenOrientation,
        ),
        source: typeof iosCompassHeading === 'number'
          ? 'ios-compass'
          : 'absolute-orientation',
        compassAccuracy: typeof orientationEvent.webkitCompassAccuracy === 'number'
          ? orientationEvent.webkitCompassAccuracy
          : null,
      };
      if (animationFrame === null) animationFrame = window.requestAnimationFrame(commitLatestSample);
    };

    const handleMotion = () => {
      setDiagnostics((current) => current.motionAvailable
        ? current
        : { ...current, motionAvailable: true });
    };

    const handleScreenOrientation = () => {
      const screenOrientation = getScreenOrientationDegrees();
      screenOrientationRef.current = screenOrientation;
      smoothedHeadingRef.current = null;
      samplesRef.current = [];
      setDiagnostics((current) => ({
        ...current,
        rawHeading: null,
        smoothedHeading: null,
        stabilityDegrees: null,
        orientationAvailable: false,
        screenOrientation,
      }));
    };

    armSensorWatchdog();

    window.addEventListener('deviceorientationabsolute', handleOrientation);
    window.addEventListener('deviceorientation', handleOrientation);
    window.addEventListener('devicemotion', handleMotion);
    window.addEventListener('orientationchange', handleScreenOrientation);
    window.screen.orientation?.addEventListener('change', handleScreenOrientation);

    return () => {
      window.removeEventListener('deviceorientationabsolute', handleOrientation);
      window.removeEventListener('deviceorientation', handleOrientation);
      window.removeEventListener('devicemotion', handleMotion);
      window.removeEventListener('orientationchange', handleScreenOrientation);
      window.screen.orientation?.removeEventListener('change', handleScreenOrientation);
      if (sensorTimeout !== null) window.clearTimeout(sensorTimeout);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    };
  }, [active, permission]);

  const locationAgeMs = locationTimestamp === null ? null : Math.max(0, Date.now() - locationTimestamp);
  const confidence = useMemo(() => getSensorConfidence({
    hasHeading: diagnostics.smoothedHeading !== null && diagnostics.orientationAvailable,
    headingSource: diagnostics.headingSource,
    stabilityDegrees: diagnostics.stabilityDegrees,
    compassAccuracy: diagnostics.compassAccuracy,
    gpsAccuracy,
    locationAgeMs,
    distanceMeters,
  }), [
    diagnostics.compassAccuracy,
    diagnostics.headingSource,
    diagnostics.orientationAvailable,
    diagnostics.smoothedHeading,
    diagnostics.stabilityDegrees,
    distanceMeters,
    gpsAccuracy,
    locationAgeMs,
  ]);

  return {
    permission,
    requestPermission,
    heading: diagnostics.smoothedHeading,
    confidence,
    diagnostics,
    locationAgeMs,
  };
}