import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { AlertTriangle, Check, RefreshCw, X, ArrowLeft } from 'lucide-react';
import { CinematicLine } from '@/components/line/CinematicLine';
import { api, ApiError } from '@/services/api';
import type { LocationState, LocationData } from '@/hooks/useLocation';
import { useOrientationController, normalizeDegrees, signedAngleDifference } from '@/hooks/useOrientationController';
import { useArCapability } from '@/hooks/useArCapability';
import { startWorldArSession, type WorldArController, type WorldArDiagnostics } from '@/spatial/adapters/webxr';
import { createSpatialAnchorFrameDraft, type SpatialAnchorFrameDraft } from '@/spatial/anchorFrame';
import { createSpatialDiagnosticSample } from '@/spatial/diagnostics';
import { SpatialFieldRecorder } from '@/spatial/fieldTestRecorder';

type DropPlacementProps = {
  letterId: string;
  text: string;
  location: LocationState;
  onSuccess: () => void;
  onCancel: () => void;
};

type DropState = 'prompt' | 'authorizing' | 'placement' | 'confirming' | 'active' | 'failed' | 'interrupted';

const DEVELOPMENT_MODE = import.meta.env.DEV;

// Haversine distance
function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3;
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dp / 2) * Math.sin(dp / 2) +
            Math.cos(p1) * Math.cos(p2) *
            Math.sin(dl / 2) * Math.sin(dl / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function isLocationValid(loc: LocationData | null) {
  if (!loc) return false;
  const age = Date.now() - loc.timestamp;
  return age <= 15000 && loc.accuracy <= 25;
}

export function DropPlacement({ letterId, text, location, onSuccess, onCancel }: DropPlacementProps) {
  const [dropState, setDropState] = useState<DropState>('prompt');
  const [dropHandle, setDropHandle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gpsWait, setGpsWait] = useState(false);
  
  const [cameraState, setCameraState] = useState<'prompt' | 'requesting' | 'granted' | 'denied' | 'simulated'>('prompt');
  const [beamVisualBearing, setBeamVisualBearing] = useState<number | null>(null);
  
  const [worldArActive, setWorldArActive] = useState(false);
  const [worldArStarting, setWorldArStarting] = useState(false);
  const [worldArDiagnostics, setWorldArDiagnostics] = useState<WorldArDiagnostics | null>(null);
  const [activeDistance, setActiveDistance] = useState<number>(3); // distance from anchored point in active state
  const [fieldSampleCount, setFieldSampleCount] = useState(0);
  
  // Dev simulations
  const [simFreshGps, setSimFreshGps] = useState(false);
  const [simStaleGps, setSimStaleGps] = useState(false);
  const [simPoorGps, setSimPoorGps] = useState(false);
  const [simArUnsupported, setSimArUnsupported] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraRootRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const worldArControllerRef = useRef<WorldArController | null>(null);
  const mountedRef = useRef(true);
  const dragRef = useRef<{ pointerId: number; startX: number; startYaw: number } | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const anchorFrameDraftRef = useRef<SpatialAnchorFrameDraft | null>(null);
  const fieldRecorderRef = useRef(new SpatialFieldRecorder());

  const authAttemptedRef = useRef(false);
  const confirmAttemptedRef = useRef(false);
  
  // Save confirmation location for walk-away
  const anchorLocRef = useRef<{ lat: number, lng: number } | null>(null);

  const orientation = useOrientationController({
    active: cameraState === 'granted' && !worldArActive,
    gpsAccuracy: location.location?.accuracy ?? null,
    locationTimestamp: location.location?.timestamp ?? null,
    distanceMeters: 3,
  });

  const getEffectiveLocation = useCallback(() => {
    let loc = location.location;
    if (DEVELOPMENT_MODE) {
      if (simFreshGps && loc) loc = { ...loc, accuracy: Math.min(loc.accuracy, 10), timestamp: Date.now() };
      if (simStaleGps && loc) loc = { ...loc, timestamp: Date.now() - 30000 };
      if (simPoorGps && loc) loc = { ...loc, accuracy: 50 };
    }
    return loc;
  }, [location.location, simFreshGps, simStaleGps, simPoorGps]);

  useEffect(() => {
    if (beamVisualBearing === null && orientation.heading !== null) {
      setBeamVisualBearing(orientation.heading);
    }
  }, [beamVisualBearing, orientation.heading]);

  const releaseCurrentStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const acquireCamera = useCallback(async () => {
    if (cameraState === 'simulated') return 'simulated';
    if (!navigator.mediaDevices?.getUserMedia) return 'denied';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return 'cancelled';
      }
      releaseCurrentStream();
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      return 'granted';
    } catch {
      return 'denied';
    }
  }, [releaseCurrentStream, cameraState]);

  const handleStartPlacement = async () => {
    const p = await orientation.requestPermission();
    if (p !== 'granted') setBeamVisualBearing((current) => current ?? 0);
    
    setCameraState('requesting');
    const camRes = await acquireCamera();
    if (mountedRef.current && camRes !== 'cancelled') {
      setCameraState(camRes);
      if (camRes === 'denied') {
        setError('Camera access is required for placement.');
        setDropState('failed');
        return;
      }
    }
    
    setDropState('authorizing');
    authAttemptedRef.current = false;
  };

  const handleSimulatedCameraStart = () => {
    setCameraState('simulated');
    setBeamVisualBearing(0);
    authAttemptedRef.current = false;
    setDropState('authorizing');
  };

  const executeAuthorize = useCallback(async () => {
    const loc = getEffectiveLocation();
    if (!isLocationValid(loc)) {
      setGpsWait(true);
      if (!location.loading) location.requestLocation();
      return;
    }
    setGpsWait(false);
    setError(null);
    try {
      const auth = await api.authorizeDrop({
        id: letterId,
        text,
        latitude: loc!.latitude,
        longitude: loc!.longitude,
        accuracy: loc!.accuracy,
        timestamp: loc!.timestamp,
      });
      if (mountedRef.current) {
        setDropHandle(auth.dropHandle);
        setDropState('placement');
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof ApiError ? err.message : 'Failed to authorize placement.');
        setDropState('failed');
      }
    }
  }, [getEffectiveLocation, location, letterId, text]);

  const executeConfirm = useCallback(async () => {
    if (!dropHandle) return;
    const loc = getEffectiveLocation();
    if (!isLocationValid(loc)) {
      setGpsWait(true);
      if (!location.loading) location.requestLocation();
      return;
    }
    setGpsWait(false);
    setError(null);
    try {
      await api.confirmDrop(dropHandle, {
        latitude: loc!.latitude,
        longitude: loc!.longitude,
        accuracy: loc!.accuracy,
        timestamp: loc!.timestamp,
      });
      if (mountedRef.current) {
        anchorLocRef.current = { lat: loc!.latitude, lng: loc!.longitude };
        if (worldArDiagnostics?.primaryAnchorPosition) {
          anchorFrameDraftRef.current = createSpatialAnchorFrameDraft({
            adapter: 'webxr',
            geographicHint: {
              latitude: loc!.latitude,
              longitude: loc!.longitude,
              accuracyMeters: loc!.accuracy,
              observedAt: loc!.timestamp,
            },
            anchorPosition: worldArDiagnostics.primaryAnchorPosition,
          });
        }
        worldArControllerRef.current?.setActive?.();
        setDropState('active');
      }
    } catch (err) {
      if (mountedRef.current) {
        if (
          err instanceof ApiError
          && (err.status === 401 || err.status === 403 || err.status === 404 || err.status === 409)
        ) {
          setDropHandle(null);
          setDropState('authorizing');
          authAttemptedRef.current = false;
        } else {
          setError(err instanceof ApiError ? err.message : 'Failed to anchor letter.');
          setDropState('failed');
        }
      }
    }
  }, [dropHandle, getEffectiveLocation, location, worldArDiagnostics]);

  useEffect(() => {
    if (dropState === 'authorizing' && !authAttemptedRef.current) {
      const loc = getEffectiveLocation();
      if (isLocationValid(loc)) {
        authAttemptedRef.current = true;
        executeAuthorize();
      } else if (location.status === 'error' || location.status === 'denied' || location.status === 'timeout' || location.status === 'unavailable') {
        setError(location.error || 'Location unavailable');
        setDropState('failed');
      } else if (!location.loading) {
        setGpsWait(true);
        location.requestLocation();
      }
    }
  }, [dropState, getEffectiveLocation, location.status, location.error, location.loading, executeAuthorize, location.requestLocation]);

  useEffect(() => {
    if (dropState === 'confirming' && !confirmAttemptedRef.current) {
      const loc = getEffectiveLocation();
      if (isLocationValid(loc)) {
        confirmAttemptedRef.current = true;
        executeConfirm();
      } else if (location.status === 'error' || location.status === 'denied' || location.status === 'timeout' || location.status === 'unavailable') {
        setError(location.error || 'Location unavailable');
        setDropState('failed');
      } else if (!location.loading) {
        setGpsWait(true);
        location.requestLocation();
      }
    }
  }, [dropState, getEffectiveLocation, location.status, location.error, location.loading, executeConfirm, location.requestLocation]);

  // Handle visibility / backgrounding cleanup
  useEffect(() => {
    const handleHide = () => {
      if (dropState === 'placement' || dropState === 'confirming' || dropState === 'authorizing') {
         releaseCurrentStream();
         worldArControllerRef.current?.end('backgrounded');
         setWorldArActive(false);
         setWorldArStarting(false);
         setDropState('interrupted');
         setError('Placement was interrupted.');
      } else if (dropState === 'active') {
         // In active, we just clean up camera/AR but stay active logically (let them be walked away)
         releaseCurrentStream();
         worldArControllerRef.current?.end('backgrounded');
         setWorldArActive(false);
         setWorldArStarting(false);
      }
    };
    
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') handleHide();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handleHide);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handleHide);
    };
  }, [dropState, releaseCurrentStream]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseCurrentStream();
      worldArControllerRef.current?.end('system');
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, [releaseCurrentStream]);
  
  // Track walking away in ACTIVE state
  useEffect(() => {
    if (dropState === 'active' && anchorLocRef.current && navigator.geolocation) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          if (!mountedRef.current) return;
          const dist = calculateDistanceMeters(
            anchorLocRef.current!.lat,
            anchorLocRef.current!.lng,
            pos.coords.latitude,
            pos.coords.longitude
          );
          setActiveDistance(Math.max(3, dist)); // Never show less than 3m base
        },
        () => {}, // ignore watch errors
        { enableHighAccuracy: true }
      );
    }
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [dropState]);

  const arCapability = useArCapability({
    cameraAvailable: cameraState === 'granted',
    trustedHeadingAvailable: orientation.permission === 'granted' && orientation.heading !== null && orientation.confidence === 'high',
  });

  const startWorldView = useCallback(async () => {
    const overlayRoot = cameraRootRef.current;
    if (!overlayRoot || cameraState !== 'granted' || beamVisualBearing === null || worldArStarting) return;
    if (simArUnsupported || arCapability.state !== 'WORLD_AR_SUPPORTED') return;

    setWorldArStarting(true);
    releaseCurrentStream();

    try {
      const controller = await startWorldArSession({
        overlayRoot,
        headingDegrees: beamVisualBearing,
        signals: [{
          id: letterId,
          distanceMeters: activeDistance,
          bearingDegrees: beamVisualBearing,
          prominence: 'primary',
          isUnlocked: dropState === 'active'
        }],
        onControllerReady: (c) => { worldArControllerRef.current = c; },
        onDiagnostics: (diagnostics) => {
          if (!mountedRef.current) return;
          setWorldArDiagnostics(diagnostics);
          if (DEVELOPMENT_MODE) {
            fieldRecorderRef.current.record(createSpatialDiagnosticSample({
              cameraPosition: diagnostics.cameraPosition,
              anchorPosition: diagnostics.primaryAnchorPosition,
              trackingState: diagnostics.trackingState,
              trackingLosses: diagnostics.trackingLosses,
              framesPerSecond: diagnostics.framesPerSecond,
            }));
            setFieldSampleCount(fieldRecorderRef.current.sampleCount);
          }
        },
        onEnded: () => {
          worldArControllerRef.current = null;
          if (mountedRef.current) {
            setWorldArDiagnostics(null);
            setWorldArActive(false);
            setWorldArStarting(false);
            if (dropState !== 'active' && dropState !== 'interrupted' && dropState !== 'failed') {
               acquireCamera().then((res) => { if (res !== 'cancelled') setCameraState(res); });
            }
          }
        },
      });
      if (mountedRef.current) setWorldArActive(true);
    } catch (e) {
      worldArControllerRef.current = null;
      if (mountedRef.current) {
        acquireCamera().then((res) => { if (res !== 'cancelled') setCameraState(res); });
      }
    } finally {
      if (mountedRef.current) setWorldArStarting(false);
    }
  }, [cameraState, beamVisualBearing, worldArStarting, arCapability.state, simArUnsupported, releaseCurrentStream, letterId, dropState, activeDistance, acquireCamera]);

  useEffect(() => {
    if (dropState === 'placement' && !worldArActive && !worldArStarting && arCapability.state === 'WORLD_AR_SUPPORTED' && !simArUnsupported && beamVisualBearing !== null && cameraState === 'granted') {
      startWorldView();
    }
  }, [dropState, worldArActive, worldArStarting, arCapability.state, simArUnsupported, beamVisualBearing, cameraState, startWorldView]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dropState !== 'placement') return;
    if ((event.target as HTMLElement).closest('button')) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startYaw: beamVisualBearing ?? 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextHeading = normalizeDegrees(drag.startYaw - (event.clientX - drag.startX) * 0.45);
    setBeamVisualBearing(nextHeading);
    if (worldArActive && worldArControllerRef.current?.reposition) {
       worldArControllerRef.current.reposition(nextHeading);
    }
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const handleLeaveItHere = () => {
    confirmAttemptedRef.current = false;
    setDropState('confirming');
  };

  const handleCopyFieldReport = () => {
    const report = fieldRecorderRef.current.finish();
    const serialized = JSON.stringify({
      ...report,
      anchorFrameDraft: anchorFrameDraftRef.current,
    }, null, 2);
    void navigator.clipboard?.writeText(serialized).catch(() => undefined);
  };
  
  // Calculate rendering intensity dynamically for walk away
  const intensity = dropState === 'active' ? Math.max(0.3, 1 - (activeDistance - 3) / 100) : 0.6;
  const beamOpacity = dropState === 'active' ? Math.max(0.2, 1 - (activeDistance - 3) / 50) : 0.4;
  const atmosphereOpacity = dropState === 'active' ? Math.max(0.1, 0.8 - (activeDistance - 3) / 50) : 0.15;

  return (
    <div 
      className="line-drop-camera-root" 
      ref={cameraRootRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      {!worldArActive && cameraState !== 'simulated' && (
        <video 
          ref={videoRef} 
          className="line-camera-video" 
          playsInline 
          muted 
          autoPlay 
        />
      )}
      
      {dropState === 'prompt' && (
        <div className="line-placement-overlay">
          <div className="line-placement-status">
            <h3 className="line-serif" style={{ fontSize: '2.4rem', color: 'var(--line-paper)', marginBottom: '16px' }}>Ready to place.</h3>
            <button 
              className="line-btn-primary line-mono" 
              onClick={handleStartPlacement}
              data-testid="button-start-placement"
              style={{ width: '100%', maxWidth: '240px', padding: '16px' }}
            >
              OPEN CAMERA TO PLACE
            </button>
            <button onClick={onCancel} className="line-btn-secondary line-mono" data-testid="button-cancel-placement" style={{ marginTop: '8px' }}>
              Cancel drop
            </button>
          </div>
        </div>
      )}
      
      {!worldArActive && beamVisualBearing !== null && (dropState === 'placement' || dropState === 'confirming' || dropState === 'active') && (
        <CinematicLine
          letterId={letterId}
          distanceMeters={activeDistance}
          bearing={beamVisualBearing}
          isUnlocked={dropState === 'active'}
          intensity={intensity}
          beamOpacity={beamOpacity}
          atmosphereOpacity={atmosphereOpacity}
          scale={1}
          horizontalPosition={50 + (signedAngleDifference(beamVisualBearing, orientation.heading ?? 0) / 45) * 50}
          pulse={dropState === 'active'}
        />
      )}

      {dropState === 'authorizing' && (
        <div className="line-placement-overlay">
          <div className="line-placement-status" data-testid="state-authorizing">
            <RefreshCw size={24} strokeWidth={1.5} className="line-refresh-spinning" />
            <p className="line-mono">{gpsWait ? 'SECURING LOCATION...' : 'PREPARING DROP...'}</p>
          </div>
        </div>
      )}

      {(dropState === 'failed' || dropState === 'interrupted') && (
        <div className="line-placement-overlay line-placement-error" data-testid="state-error">
          <AlertTriangle size={32} strokeWidth={1.5} className="line-error-icon" />
          <h3 className="line-serif">Signal interrupted</h3>
          <p>{error}</p>
          <div className="line-placement-actions">
            <button 
              onClick={() => {
                if (dropState === 'interrupted' || cameraState === 'denied') {
                  setDropHandle(null);
                  setCameraState('prompt');
                  setDropState('prompt');
                } else if (!dropHandle) {
                  authAttemptedRef.current = false;
                  setDropState('authorizing');
                } else {
                  confirmAttemptedRef.current = false;
                  setDropState('confirming');
                }
              }} 
              className="line-btn-primary line-mono"
              data-testid="button-retry-placement"
            >
              Try again
            </button>
            <button onClick={onCancel} className="line-btn-secondary line-mono" data-testid="button-cancel-placement">Cancel drop</button>
          </div>
        </div>
      )}

      {dropState === 'placement' && (
        <div className="line-placement-ui" data-testid="state-placement">
          <header className="line-placement-header">
            <span className="line-mono">POSITION SIGNAL</span>
            <button onClick={onCancel} className="line-placement-close" aria-label="Cancel" data-testid="button-close-placement">
              <X size={20} strokeWidth={1.5}/>
            </button>
          </header>
          <div className="line-placement-instruction" data-testid="placement-reposition-surface">
            <p className="line-mono">Drag to reposition the signal</p>
          </div>
          <div className="line-placement-footer">
            <button className="line-btn-primary line-mono line-leave-btn" onClick={handleLeaveItHere} data-testid="button-leave-it-here">
              LEAVE IT HERE
            </button>
          </div>
        </div>
      )}

      {dropState === 'confirming' && (
        <div className="line-placement-overlay">
          <div className="line-placement-status" data-testid="state-confirming">
            <RefreshCw size={24} strokeWidth={1.5} className="line-refresh-spinning" />
            <p className="line-mono">{gpsWait ? 'VERIFYING LOCATION...' : 'ANCHORING SIGNAL...'}</p>
          </div>
        </div>
      )}

      {dropState === 'active' && (
        <div className="line-placement-ui line-placement-active-ui" data-testid="state-active">
          <div className="line-placement-success-content line-reveal">
            <Check size={48} strokeWidth={1.5} className="line-success-icon" />
            <h2 className="line-serif">It's there now.</h2>
            <p className="line-mono" style={{ color: 'var(--line-ash)', fontSize: '0.65rem', marginTop: '-8px' }}>
              {Math.round(activeDistance)}m away
            </p>
          </div>
          <div style={{ position: 'absolute', bottom: '32px', left: '0', right: '0', display: 'flex', justifyContent: 'center' }}>
            <button 
              className="line-btn-primary line-mono" 
              onClick={onSuccess} 
              data-testid="button-finish-placement"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 24px', fontSize: '0.65rem' }}
            >
              <ArrowLeft size={16} strokeWidth={1.5} />
              RETURN TO DISCOVER
            </button>
          </div>
        </div>
      )}

      {DEVELOPMENT_MODE && (
        <div className="line-placement-diagnostics" style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', flexWrap: 'wrap', gap: 4, background: 'rgba(0,0,0,0.8)', color: '#fff', fontSize: '10px', padding: 4, zIndex: 9999 }}>
          <span style={{color: 'var(--line-coral)', fontWeight: 'bold', width: '100%'}}>DEV DIAGNOSTICS</span>
          <button onClick={() => setSimFreshGps(!simFreshGps)} style={{border: simFreshGps ? '1px solid var(--line-coral)' : '1px solid #555', padding: 4}}>Fresh GPS</button>
          <button onClick={() => setSimStaleGps(!simStaleGps)} style={{border: simStaleGps ? '1px solid var(--line-coral)' : '1px solid #555', padding: 4}}>Stale GPS</button>
          <button onClick={() => setSimPoorGps(!simPoorGps)} style={{border: simPoorGps ? '1px solid var(--line-coral)' : '1px solid #555', padding: 4}}>Poor GPS</button>
          <button onClick={() => setSimArUnsupported(!simArUnsupported)} style={{border: simArUnsupported ? '1px solid var(--line-coral)' : '1px solid #555', padding: 4}}>No AR</button>
          <button onClick={handleSimulatedCameraStart} style={{border: '1px solid #555', padding: 4}}>Simulate Cam</button>
          <button onClick={() => { setError('Simulated network rejection'); setDropState('failed'); }} style={{border: '1px solid #555', padding: 4}}>Net Fail</button>
          <button onClick={() => { setDropHandle(null); setError('Simulated expiry'); setDropState('failed'); }} style={{border: '1px solid #555', padding: 4}}>Auth Expire</button>
          <button onClick={() => { anchorLocRef.current = {lat: location.location?.latitude || 0, lng: location.location?.longitude || 0}; setDropState('active'); }} style={{border: '1px solid #555', padding: 4}}>Force Active</button>
          <button onClick={handleCopyFieldReport} style={{border: '1px solid #555', padding: 4}}>Copy Field Report</button>
          <div style={{width: '100%', fontSize: '9px', opacity: 0.8}}>State: {dropState} | Cam: {cameraState} | AR: {worldArActive?'On':(worldArStarting?'Starting':'Off')} | Dist: {Math.round(activeDistance)}m</div>
          <div style={{width: '100%', fontSize: '9px', opacity: 0.8}}>
            Anchor: {worldArDiagnostics?.primaryAnchorPosition
              ? `${worldArDiagnostics.primaryAnchorPosition.x.toFixed(2)}, ${worldArDiagnostics.primaryAnchorPosition.y.toFixed(2)}, ${worldArDiagnostics.primaryAnchorPosition.z.toFixed(2)}`
              : 'pending'} | Losses: {worldArDiagnostics?.trackingLosses ?? 0} | Samples: {fieldSampleCount} | Draft: {anchorFrameDraftRef.current ? 'captured' : 'none'}
          </div>
        </div>
      )}
    </div>
  );
}