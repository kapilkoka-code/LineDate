import {
  Crosshair,
  LocateFixed,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { LocationState, LocationStatus } from '@/hooks/useLocation';

type LocationPanelProps = {
  location: LocationState;
};

const statusLabels: Record<LocationStatus, string> = {
  checking: 'CHECKING ACCESS',
  prompt: 'LOCATION REQUIRED',
  requesting: 'LOCATING',
  active: 'LOCATION ACTIVE',
  dismissed: 'LOCATION OFF',
  denied: 'LOCATION BLOCKED',
  unavailable: 'SIGNAL UNAVAILABLE',
  timeout: 'LOCATION TIMED OUT',
  unsupported: 'LOCATION UNAVAILABLE',
  error: 'LOCATION ERROR',
};

function StatusDot() {
  return <span className="line-status-dot" aria-hidden="true" />;
}

export function LocationHeaderStatus({ status }: { status: LocationStatus }) {
  return (
    <span
      className={`line-header-status line-mono line-location-header line-location-${status}`}
      data-testid="text-location-status"
    >
      <StatusDot />
      {statusLabels[status]}
    </span>
  );
}

function Accuracy({ value }: { value: number }) {
  return (
    <span className="line-location-accuracy">
      Accuracy: approximately {Math.max(1, Math.round(value))}m
    </span>
  );
}

function RefreshButton({
  onClick,
  disabled,
  label = 'Refresh location',
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="line-location-refresh"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-testid="button-refresh-location"
    >
      <RefreshCw size={14} strokeWidth={1.4} className={disabled ? 'line-refresh-spinning' : ''} />
      <span className="line-mono">RECENTER</span>
    </button>
  );
}

export function LocationPanel({ location }: LocationPanelProps) {
  const { status, location: currentLocation, loading, error, requestLocation, dismissPrompt } =
    location;

  if (status === 'prompt' || status === 'checking' || status === 'requesting') {
    return (
      <section className="line-location-panel line-location-permission line-view-enter" data-testid="panel-location-permission">
        <div className="line-location-panel-mark" aria-hidden="true">
          <Crosshair size={22} strokeWidth={1.1} />
        </div>
        <div className="line-location-panel-copy">
          <span className="line-section-index line-mono">LOCATION / PERMISSION</span>
          <h2 className="line-location-title line-serif">Be where the signal is.</h2>
          <p>LINE needs your location to connect you with things happening around you.</p>
          <div className="line-location-actions">
            <button
              type="button"
              className="line-location-primary"
              onClick={requestLocation}
              disabled={status === 'checking'}
              data-testid="button-enable-location"
            >
              <LocateFixed size={14} strokeWidth={1.4} />
              <span className="line-mono">
                {status === 'checking'
                  ? 'Checking access'
                  : status === 'requesting'
                    ? 'Locating'
                    : 'Enable location'}
              </span>
            </button>
            <button
              type="button"
              className="line-location-secondary line-mono"
              onClick={dismissPrompt}
              disabled={status === 'checking' || status === 'requesting'}
              data-testid="button-dismiss-location"
            >
              Not now
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (status === 'active' && currentLocation) {
    return (
      <section className="line-location-panel line-location-active-panel" data-testid="panel-location-active">
        <div className="line-location-active-copy">
          <span className="line-location-live-mark"><StatusDot /></span>
          <div>
            <span className="line-mono line-location-kicker">LOCATION ACTIVE</span>
            <Accuracy value={currentLocation.accuracy} />
          </div>
        </div>
        <RefreshButton onClick={requestLocation} disabled={loading} label="Refresh current location" />
      </section>
    );
  }

  if (status === 'dismissed') {
    return (
      <section className="line-location-panel line-location-muted-panel" data-testid="panel-location-dismissed">
        <div>
          <span className="line-mono line-location-kicker">LOCATION OFF</span>
          <p>Location stays private and only lives for this session.</p>
        </div>
        <RefreshButton onClick={requestLocation} disabled={loading} label="Enable location" />
      </section>
    );
  }

  if (status === 'denied' || status === 'unavailable' || status === 'timeout' || status === 'unsupported' || status === 'error') {
    const title =
      status === 'denied'
        ? 'Location access is paused.'
        : status === 'unsupported'
          ? 'Location is not available here.'
          : 'LINE couldn’t determine your location.';

    const message = error ?? 'Please check your device location settings and try again.';

    return (
      <section className="line-location-panel line-location-error-panel line-view-enter" data-testid="panel-location-error">
        <div className="line-location-error-copy">
          <span className="line-mono line-location-kicker">{statusLabels[status]}</span>
          <h2 className="line-location-error-title line-serif">{title}</h2>
          <p>{message}</p>
        </div>
        {status !== 'unsupported' && (
          <button
            type="button"
            className="line-location-primary line-location-retry"
            onClick={requestLocation}
            disabled={loading}
            data-testid="button-retry-location"
          >
            <RefreshCw size={14} strokeWidth={1.4} />
            <span className="line-mono">Try again</span>
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="line-location-panel line-location-muted-panel" data-testid="panel-location-loading">
      <div className="line-location-active-copy">
        <ShieldCheck size={16} strokeWidth={1.3} />
        <span className="line-mono">LOCATION IS PRIVATE</span>
      </div>
      <RefreshButton onClick={requestLocation} disabled={loading} />
    </section>
  );
}