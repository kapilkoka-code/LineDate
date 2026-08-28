import { RefreshCw, X } from 'lucide-react';
import type { LocationStatus } from '@/hooks/useLocation';
import type { NearbyLetter } from '@/services/discovery';

type DiscoveryFieldProps = {
  letters: NearbyLetter[];
  selectedLetter: NearbyLetter | null;
  locationStatus: LocationStatus;
  locationReady: boolean;
  loading: boolean;
  onRefresh: () => void;
  onSelect: (letter: NearbyLetter) => void;
  onDismiss: () => void;
};

function EmptyFieldState({
  locationStatus,
  locationReady,
}: Pick<DiscoveryFieldProps, 'locationStatus' | 'locationReady'>) {
  const isLoading = locationStatus === 'checking' || locationStatus === 'requesting';
  const title = locationReady ? 'Nothing here.' : isLoading ? 'Finding you.' : 'Location needed.';
  const message = locationReady
    ? 'Maybe someone will leave something behind.'
    : isLoading
      ? 'Looking for nearby signals.'
      : 'Enable location to find letters around you.';
  const kicker = locationReady ? 'NO SIGNALS WITHIN 100M' : isLoading ? 'GPS LOADING' : 'DISCOVERY PAUSED';

  return (
    <div className="line-field-empty" data-testid="state-discovery-empty">
      <span className="line-mono line-field-empty-kicker">{kicker}</span>
      <div className="line-field-empty-title line-serif">{title}</div>
      <p>{message}</p>
    </div>
  );
}

export function DiscoveryField({
  letters,
  selectedLetter,
  locationStatus,
  locationReady,
  loading,
  onRefresh,
  onSelect,
  onDismiss,
}: DiscoveryFieldProps) {
  const hasResults = locationReady && letters.length > 0;

  return (
    <section
      className={`line-discovery-field line-view-enter ${hasResults ? '' : 'line-discovery-field-empty'}`}
      aria-label="Nearby anonymous letters"
    >
      <div className="line-field-grid" aria-hidden="true" />
      <div className="line-field-crosshair line-field-crosshair-top" aria-hidden="true" />
      <div className="line-field-crosshair line-field-crosshair-bottom" aria-hidden="true" />
      <div className="line-field-label line-mono" data-testid="text-discovery-location">NEARBY FIELD / WITHIN 100M</div>
      <div className="line-field-coordinates line-mono" aria-hidden="true">COORDINATES HIDDEN</div>
      {hasResults && <div className="line-field-note line-serif">Somewhere<br />nearby.</div>}
      <div className="line-field-scan-line line-scan" aria-hidden="true" />

      {locationReady && (
        <button
          type="button"
          className="line-field-refresh line-mono"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh nearby letters"
          data-testid="button-refresh-discovery"
        >
          <RefreshCw size={13} strokeWidth={1.4} className={loading ? 'line-refresh-spinning' : ''} />
          REFRESH
        </button>
      )}

      {letters.map((letter) => (
        <button
          key={letter.id}
          type="button"
          className={`line-marker line-marker-${letter.tone}`}
          style={{ top: letter.top, left: letter.left }}
          onClick={() => onSelect(letter)}
          aria-label={`Open anonymous letter ${letter.distanceLabel} away`}
          data-testid={`button-letter-marker-${letter.distanceMeters}`}
        >
          <span className="line-marker-dot line-marker-pulse" aria-hidden="true" />
          <span className="line-marker-label line-mono">
            <span className="line-marker-letter-label">ANONYMOUS LETTER</span>
            {letter.distanceLabel}
          </span>
        </button>
      ))}

      {!hasResults && <EmptyFieldState locationStatus={locationStatus} locationReady={locationReady} />}

      {selectedLetter && (
        <div className="line-letter-card line-view-enter" data-testid="card-selected-letter">
          <button type="button" className="line-card-close" onClick={onDismiss} aria-label="Close letter preview" data-testid="button-dismiss-letter">
            <X size={15} />
          </button>
          <span className="line-mono line-card-kicker">SIGNAL DETECTED</span>
          <div className="line-card-title line-serif">Anonymous letter</div>
          <div className="line-card-meta">
            <span>{selectedLetter.distanceLabel} away</span>
            <span className="line-card-dot" aria-hidden="true" />
            <span>Unopened</span>
          </div>
          <p>Move closer to discover.</p>
        </div>
      )}
    </section>
  );
}