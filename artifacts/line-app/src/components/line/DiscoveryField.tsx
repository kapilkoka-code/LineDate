import { X } from 'lucide-react';
import { discoveryLetters, type DiscoveryLetter } from '@/data/discovery';

type DiscoveryFieldProps = {
  selectedLetter: DiscoveryLetter | null;
  onSelect: (letter: DiscoveryLetter) => void;
  onDismiss: () => void;
};

export function DiscoveryField({ selectedLetter, onSelect, onDismiss }: DiscoveryFieldProps) {
  return (
    <section className="line-discovery-field line-view-enter" aria-label="Fictional preview signals">
      <div className="line-field-grid" aria-hidden="true" />
      <div className="line-field-crosshair line-field-crosshair-top" aria-hidden="true" />
      <div className="line-field-crosshair line-field-crosshair-bottom" aria-hidden="true" />
      <div className="line-field-label line-mono" data-testid="text-discovery-location">PREVIEW FIELD / FICTIONAL SIGNALS</div>
      <div className="line-field-coordinates line-mono" aria-hidden="true">NO LIVE LETTER DATA</div>
      <div className="line-field-note line-serif">Somewhere<br />nearby.</div>
      <div className="line-field-scan-line line-scan" aria-hidden="true" />

      {discoveryLetters.map((letter) => (
        <button
          key={letter.id}
          type="button"
          className={`line-marker line-marker-${letter.tone}`}
          style={{ top: letter.top, left: letter.left }}
          onClick={() => onSelect(letter)}
          aria-label={`Open anonymous letter ${letter.distance} metres away`}
          data-testid={`button-letter-marker-${letter.distance}`}
        >
          <span className="line-marker-dot line-marker-pulse" aria-hidden="true" />
          <span className="line-marker-label line-mono">{letter.label}</span>
        </button>
      ))}

      {selectedLetter && (
        <div className="line-letter-card line-view-enter" data-testid="card-selected-letter">
          <button type="button" className="line-card-close" onClick={onDismiss} aria-label="Close letter preview" data-testid="button-dismiss-letter">
            <X size={15} />
          </button>
          <span className="line-mono line-card-kicker">SIGNAL DETECTED</span>
          <div className="line-card-title line-serif">Anonymous letter</div>
          <div className="line-card-meta">
            <span>{selectedLetter.distance}m away</span>
            <span className="line-card-dot" aria-hidden="true" />
            <span>Unopened</span>
          </div>
          <p>Coming in the next step.</p>
        </div>
      )}
    </section>
  );
}