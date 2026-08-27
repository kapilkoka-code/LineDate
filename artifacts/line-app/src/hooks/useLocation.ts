import { useCallback, useEffect, useRef, useState } from 'react';

export type LocationData = {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
};

export type LocationStatus =
  | 'checking'
  | 'prompt'
  | 'requesting'
  | 'active'
  | 'dismissed'
  | 'denied'
  | 'unavailable'
  | 'timeout'
  | 'unsupported'
  | 'error';

export type LocationPermission = PermissionState | 'unknown' | 'unsupported';

export type LocationState = {
  location: LocationData | null;
  loading: boolean;
  permission: LocationPermission;
  status: LocationStatus;
  error: string | null;
  isSupported: boolean;
  requestLocation: () => void;
  dismissPrompt: () => void;
};

const hasGeolocation = () =>
  typeof navigator !== 'undefined' && 'geolocation' in navigator;

function getFriendlyError(error: GeolocationPositionError): {
  status: Extract<LocationStatus, 'denied' | 'unavailable' | 'timeout' | 'error'>;
  message: string;
} {
  if (error.code === error.PERMISSION_DENIED) {
    return {
      status: 'denied',
      message:
        'Please check your device location settings and allow LINE to try again.',
    };
  }

  if (error.code === error.POSITION_UNAVAILABLE) {
    return {
      status: 'unavailable',
      message:
        'Please check your device location settings and try again somewhere with a clearer signal.',
    };
  }

  if (error.code === error.TIMEOUT) {
    return {
      status: 'timeout',
      message: 'LINE is taking a moment to locate you. Please try again.',
    };
  }

  return {
    status: 'error',
    message: 'Please check your device location settings and try again.',
  };
}

export function useLocation(): LocationState {
  const isSupported = hasGeolocation();
  const [location, setLocation] = useState<LocationData | null>(null);
  const [permission, setPermission] = useState<LocationPermission>(
    isSupported ? 'unknown' : 'unsupported',
  );
  const [status, setStatus] = useState<LocationStatus>(
    isSupported ? 'checking' : 'unsupported',
  );
  const [error, setError] = useState<string | null>(null);
  const permissionStatusRef = useRef<PermissionStatus | null>(null);

  const requestLocation = useCallback(() => {
    if (!hasGeolocation()) {
      setPermission('unsupported');
      setStatus('unsupported');
      setError('Location is not available in this browser.');
      return;
    }

    setStatus('requesting');
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        });
        setPermission('granted');
        setStatus('active');
      },
      (positionError) => {
        const friendlyError = getFriendlyError(positionError);
        setPermission(
          positionError.code === positionError.PERMISSION_DENIED
            ? 'denied'
            : permissionStatusRef.current?.state ?? 'unknown',
        );
        setStatus(friendlyError.status);
        setError(friendlyError.message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      },
    );
  }, []);

  useEffect(() => {
    if (!isSupported) return;

    let cancelled = false;
    let watchedPermission: PermissionStatus | null = null;
    let onPermissionChange: (() => void) | null = null;

    const handlePermission = (nextPermission: PermissionState) => {
      if (cancelled) return;

      setPermission(nextPermission);

      if (nextPermission === 'granted') {
        requestLocation();
      } else if (nextPermission === 'denied') {
        setStatus('denied');
        setError(
          'Please check your device location settings and allow LINE to try again.',
        );
      } else {
        setStatus('prompt');
        setError(null);
      }
    };

    if (!navigator.permissions?.query) {
      setPermission('unknown');
      setStatus('prompt');
      return () => {
        cancelled = true;
      };
    }

    navigator.permissions
      .query({ name: 'geolocation' })
      .then((permissionStatus) => {
        if (cancelled) return;

        permissionStatusRef.current = permissionStatus;
        watchedPermission = permissionStatus;
        onPermissionChange = () => handlePermission(permissionStatus.state);
        permissionStatus.addEventListener('change', onPermissionChange);
        handlePermission(permissionStatus.state);
      })
      .catch(() => {
        if (!cancelled) {
          setPermission('unknown');
          setStatus('prompt');
        }
      });

    return () => {
      cancelled = true;
      if (watchedPermission && onPermissionChange) {
        watchedPermission.removeEventListener('change', onPermissionChange);
      }
      permissionStatusRef.current = null;
    };
  }, [isSupported, requestLocation]);

  const dismissPrompt = useCallback(() => {
    setError(null);
    setStatus('dismissed');
  }, []);

  return {
    location,
    loading: status === 'checking' || status === 'requesting',
    permission,
    status,
    error,
    isSupported,
    requestLocation,
    dismissPrompt,
  };
}