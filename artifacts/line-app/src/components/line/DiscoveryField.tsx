import { BookOpen, LockKeyhole, RefreshCw, ShieldAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { LocationStatus } from '@/hooks/useLocation';
import { UNLOCK_DISTANCE_METERS, type NearbyLetter } from '@/services/discovery';

import type { SignalFieldRecord } from '@workspace/api-client-react';

type DiscoveryFieldProps = {
  signals: SignalFieldRecord[];
  selectedSignal: SignalFieldRecord | null;
  locationStatus: LocationStatus;
  locationReady: boolean;
  locationAccuracy: number | null;
  loading: boolean;
  searching: boolean;
  error: boolean;
  resolving: boolean;
  resolutionError: string | null;
  mapContent?: ReactNode;
  onRefresh: () => void;
  onSelect: (signal: SignalFieldRecord) => void;
  onDismiss: () => void;
  onNavigateFind: () => void;
};

function EmptyFieldState({
  locationStatus,
  locationReady,
  searching,
  error,
}: Pick<DiscoveryFieldProps, 'locationStatus' | 'locationReady' | 'searching' | 'error'>) {
  const isLoading = searching || locationStatus === 'checking' || locationStatus === 'requesting';
  const title = error ? 'Signal lost.' : searching ? 'SEARCHING NEARBY…' : locationReady ? 'Nothing is waiting here yet.' : isLoading ? 'Finding you.' : 'Location needed.';
  const message = error
    ? 'The field could not be read. Try again.'
    : locationReady
    ? searching ? 'Looking for nearby signals.' : 'Maybe someone will leave something behind.'
    : isLoading
      ? 'Looking for nearby signals.'
      : 'Enable location to find letters around you.';
  const kicker = error ? 'CONNECTION QUIET' : searching ? 'FIELD SEARCH' : locationReady ? 'NO SIGNALS WITHIN 100M' : isLoading ? 'GPS LOADING' : 'DISCOVERY PAUSED';

  return (
    <div className="line-field-empty" data-testid="state-discovery-empty">
      <span className="line-mono line-field-empty-kicker">{kicker}</span>
      <div className="line-field-empty-title line-serif">{title}</div>
      <p>{message}</p>
    </div>
  );
}

export function LetterReader({
  letter,
  locationAccuracy,
  loading,
  onRefresh,
  onReply,
  onClose,
}: {
  letter: NearbyLetter;
  locationAccuracy: number | null;
  loading: boolean;
  onRefresh: () => void;
  onReply: () => void;
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
      {!letter.letter.isOwn && (
        <button type="button" className="line-proximity-reply line-mono" onClick={onReply} data-testid="button-reply-to-letter">
          Reply
          <BookOpen size={13} strokeWidth={1.4} />
        </button>
      )}
    </article>
  );
}

export function DiscoveryField({
  signals,
  selectedSignal,
  locationStatus,
  locationReady,
  locationAccuracy,
  loading,
  searching,
  error,
  resolving,
  resolutionError,
  mapContent,
  onRefresh,
  onSelect,
  onDismiss,
  onNavigateFind,
}: DiscoveryFieldProps) {
  const hasResults = locationReady && signals.length > 0;

  if (selectedSignal) {
    const distanceLabel = selectedSignal.distanceBand === 'close' ? 'Close' : selectedSignal.distanceBand === 'local' ? 'Nearby' : 'Somewhere around here';
    const inaccurate = locationAccuracy !== null && locationAccuracy > UNLOCK_DISTANCE_METERS;

    return (
      <section
        className={`line-discovery-field line-view-enter ${hasResults ? '' : 'line-discovery-field-empty'} ${mapContent ? 'line-discovery-field-map' : ''}`}
        aria-label="Nearby anonymous signals"
      >
        {mapContent ?? <div className="line-field-grid" aria-hidden="true" />}
        {!mapContent && <div className="line-field-crosshair line-field-crosshair-top" aria-hidden="true" />}
        {!mapContent && <div className="line-field-crosshair line-field-crosshair-bottom" aria-hidden="true" />}

        <div className="line-letter-card line-view-enter" data-testid="card-selected-letter">
          <button type="button" className="line-card-close" onClick={onDismiss} aria-label="Close signal preview" data-testid="button-dismiss-letter">
            <X size={15} />
          </button>
          <span className="line-mono line-card-kicker">ACTIVE SIGNAL</span>
          <div className="line-card-title line-serif">{distanceLabel}</div>
          <div className="line-card-meta line-card-meta-spatial line-mono">
            <div className="line-card-meta-row">
              <span>{({
                n: 'NORTH',
                ne: 'NORTH-EAST',
                e: 'EAST',
                se: 'SOUTH-EAST',
                s: 'SOUTH',
                sw: 'SOUTH-WEST',
                w: 'WEST',
                nw: 'NORTH-WEST',
              } as const)[selectedSignal.bearingSector]} AREA</span>
              <span className="line-card-dot" aria-hidden="true" />
              <span>SEARCH REQUIRED</span>
            </div>
            <div className="line-card-lifecycle">
              {selectedSignal.timeRemaining === 'under_1_day' ? '< 24H REMAINING' :
               selectedSignal.timeRemaining === 'under_7_days' ? '< 7 DAYS REMAINING' :
               selectedSignal.timeRemaining === 'under_30_days' ? '< 30 DAYS REMAINING' :
               selectedSignal.timeRemaining === 'under_60_days' ? '< 60 DAYS REMAINING' : 'PERMANENT'}
            </div>
          </div>
          {inaccurate && (
            <div className="line-card-accuracy-warning" data-testid="warning-inaccurate-location">
              GPS ±{Math.round(locationAccuracy)}m / position may be imprecise
            </div>
          )}

          {resolutionError && (
            <div className="line-card-resolution-error" role="status">
              {resolutionError}
            </div>
          )}

          <button
            type="button"
            className="line-card-open line-mono"
            onClick={onNavigateFind}
            disabled={resolving}
            data-testid="button-find-this-line"
          >
            <BookOpen size={14} strokeWidth={1.4} />
            {resolving ? 'LOCATING SIGNAL…' : 'FIND THIS LINE'}
          </button>

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
      </section>
    );
  }

  return (
    <section
      className={`line-discovery-field line-view-enter ${hasResults ? '' : 'line-discovery-field-empty'} ${mapContent ? 'line-discovery-field-map' : ''}`}
      aria-label="Nearby anonymous letters"
    >
      {mapContent ?? <div className="line-field-grid" aria-hidden="true" />}
      {!mapContent && <div className="line-field-crosshair line-field-crosshair-top" aria-hidden="true" />}
      {!mapContent && <div className="line-field-crosshair line-field-crosshair-bottom" aria-hidden="true" />}
      <div className="line-field-label line-mono" data-testid="text-discovery-location">NEARBY FIELD / WITHIN 100M</div>
      <div className="line-field-coordinates line-mono" aria-hidden="true">COORDINATES HIDDEN</div>
      {!mapContent && hasResults && <div className="line-field-note line-serif">Somewhere<br />nearby.</div>}
      {!mapContent && <div className="line-field-scan-line line-scan" aria-hidden="true" />}

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

      {!mapContent && signals.map((signal) => {
        let hash = 0;
        for (let i = 0; i < signal.handle.length; i++) hash = ((hash << 5) - hash) + signal.handle.charCodeAt(i);
        const top = 10 + (Math.abs(hash) % 80) + '%';
        const left = 10 + ((Math.abs(hash) >> 4) % 80) + '%';
        const tone = signal.hierarchy === 'primary' ? 'coral' : signal.hierarchy === 'secondary' ? 'paper' : 'quiet';
        const distanceLabel = signal.distanceBand === 'close' ? 'Close' : signal.distanceBand === 'local' ? 'Nearby' : 'Distant';

        return (
          <button
            key={signal.handle}
            type="button"
            className={`line-field-signal line-field-signal-${tone} line-field-signal-${signal.hierarchy}`}
            style={{ top, left }}
            onClick={() => onSelect(signal)}
            aria-label="Inspect anonymous signal"
            data-testid={`button-letter-marker-${signal.handle}`}
          >
            <span className="line-field-signal-beams" aria-hidden="true"><i /><i /></span>
            <span className="line-field-signal-label line-mono">
              <span>ANONYMOUS SIGNAL</span>
              {distanceLabel}
            </span>
          </button>
        );
      })}

      {!hasResults && <EmptyFieldState locationStatus={locationStatus} locationReady={locationReady} searching={searching} error={error} />}
    </section>
  );
}