import { BookOpen, LockKeyhole, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { LocationStatus } from '@/hooks/useLocation';
import { UNLOCK_DISTANCE_METERS, type NearbyLetter } from '@/services/discovery';

type DiscoveryFieldProps = {
  letters: NearbyLetter[];
  selectedLetter: NearbyLetter | null;
  locationStatus: LocationStatus;
  locationReady: boolean;
  locationAccuracy: number | null;
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

function LetterReader({
  letter,
  locationAccuracy,
  loading,
  onRefresh,
  onClose,
}: {
  letter: NearbyLetter;
  locationAccuracy: number | null;
  loading: boolean;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const createdAt = new Date(letter.letter.createdAt);
  const dateLabel = Number.isNaN(createdAt.getTime())
    ? 'Time unknown'
    : createdAt.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const inaccurate = locationAccuracy !== null && locationAccuracy > UNLOCK_DISTANCE_METERS;

  return (
    <article className="line-proximity-reader line-view-enter" data-testid="screen-unlocked-letter">
      <div className="line-proximity-reader-topline">
        <span className="line-mono">ANONYMOUS / LETTER FOUND</span>
        <button type="button" onClick={onClose} aria-label="Close opened letter" data-testid="button-close-opened-letter">
          <X size={16} strokeWidth={1.4} />
        </button>
      </div>
      <div className="line-proximity-reader-rule" />
      <p className="line-proximity-reader-text">{letter.letter.text}</p>
      <div className="line-proximity-reader-signature line-serif">— someone who was here</div>
      <div className="line-proximity-reader-meta line-mono">
        <span>{letter.distanceLabel} AWAY</span>
        <span>{dateLabel}</span>
      </div>
      {inaccurate && (
        <div className="line-proximity-accuracy-warning" data-testid="warning-inaccurate-location">
          <ShieldAlert size={14} strokeWidth={1.3} />
          <span>GPS accuracy is approximately {Math.round(locationAccuracy)}m. Your position may be imprecise.</span>
        </div>
      )}
      <button
        type="button"
        className="line-proximity-refresh line-mono"
        onClick={onRefresh}
        disabled={loading}
        data-testid="button-refresh-opened-letter"
      >
        <RefreshCw size={13} strokeWidth={1.4} className={loading ? 'line-refresh-spinning' : ''} />
        Refresh proximity
      </button>
    </article>
  );
}

export function DiscoveryField({
  letters,
  selectedLetter,
  locationStatus,
  locationReady,
  locationAccuracy,
  loading,
  onRefresh,
  onSelect,
  onDismiss,
}: DiscoveryFieldProps) {
  const [readerOpen, setReaderOpen] = useState(false);
  const hasResults = locationReady && letters.length > 0;

  useEffect(() => {
    setReaderOpen(false);
  }, [selectedLetter?.id]);

  useEffect(() => {
    if (!selectedLetter?.isUnlocked) setReaderOpen(false);
  }, [selectedLetter?.isUnlocked]);

  if (readerOpen && selectedLetter?.isUnlocked) {
    return (
      <section className="line-discovery-field" aria-label="Opened anonymous letter">
        <LetterReader
          letter={selectedLetter}
          locationAccuracy={locationAccuracy}
          loading={loading}
          onRefresh={onRefresh}
          onClose={() => setReaderOpen(false)}
        />
      </section>
    );
  }

  const inaccurate = locationAccuracy !== null && locationAccuracy > UNLOCK_DISTANCE_METERS;

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
          className={`line-marker line-marker-${letter.tone} ${letter.isUnlocked ? 'line-marker-found' : ''}`}
          style={{ top: letter.top, left: letter.left }}
          onClick={() => onSelect(letter)}
          aria-label={`Inspect ${letter.isUnlocked ? 'found' : 'anonymous'} letter ${letter.distanceLabel} away`}
          data-testid={`button-letter-marker-${letter.id}`}
        >
          <span className="line-marker-dot line-marker-pulse" aria-hidden="true" />
          <span className="line-marker-label line-mono">
            <span className="line-marker-letter-label">{letter.isUnlocked ? 'LETTER FOUND' : 'ANONYMOUS LETTER'}</span>
            {letter.distanceLabel}
          </span>
        </button>
      ))}

      {!hasResults && <EmptyFieldState locationStatus={locationStatus} locationReady={locationReady} />}

      {selectedLetter && (
        <div className={`line-letter-card line-view-enter ${selectedLetter.isUnlocked ? 'line-letter-card-found' : ''}`} data-testid="card-selected-letter">
          <button type="button" className="line-card-close" onClick={onDismiss} aria-label="Close letter preview" data-testid="button-dismiss-letter">
            <X size={15} />
          </button>
          <span className="line-mono line-card-kicker">{selectedLetter.isUnlocked ? 'LETTER FOUND' : 'SIGNAL DETECTED'}</span>
          <div className="line-card-title line-serif">{selectedLetter.isUnlocked ? selectedLetter.distanceLabel : 'Anonymous letter'}</div>
          <div className="line-card-meta">
            <span>{selectedLetter.distanceLabel} away</span>
            <span className="line-card-dot" aria-hidden="true" />
            <span>{selectedLetter.isUnlocked ? 'Within range' : 'Locked'}</span>
          </div>
          {inaccurate && (
            <div className="line-card-accuracy-warning" data-testid="warning-inaccurate-location">
              GPS ±{Math.round(locationAccuracy)}m / position may be imprecise
            </div>
          )}
          {selectedLetter.isUnlocked ? (
            <button
              type="button"
              className="line-card-open line-mono"
              onClick={() => setReaderOpen(true)}
              data-testid="button-open-letter"
            >
              <BookOpen size={14} strokeWidth={1.4} />
              Open letter
            </button>
          ) : (
            <p><LockKeyhole size={13} strokeWidth={1.3} /> Move closer to discover.</p>
          )}
          <button
            type="button"
            className="line-card-refresh line-mono"
            onClick={onRefresh}
            disabled={loading}
            data-testid="button-refresh-selected-letter"
          >
            <RefreshCw size={12} strokeWidth={1.4} className={loading ? 'line-refresh-spinning' : ''} />
            Refresh proximity
          </button>
        </div>
      )}
    </section>
  );
}