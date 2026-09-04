import { ArrowLeft, Check, ChevronDown, FilePenLine, LocateFixed, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';
import type { LocationState } from '@/hooks/useLocation';
import { createLetterId } from '@/services/letters';
import { DropPlacement } from '@/components/line/DropPlacement';

type LetterComposerProps = {
  location: LocationState;
  onClose: () => void;
};

type ComposerStage = 'write' | 'preview' | 'placement' | 'complete';

function LetterLocation({ location }: { location: LocationState }) {
  const activeLocation = location.status === 'active' ? location.location : null;
  const isRequesting = location.status === 'checking' || location.status === 'requesting';
  const actionLabel =
    location.status === 'prompt' || location.status === 'dismissed'
      ? 'Enable location'
      : 'Try again';

  if (activeLocation) {
    return (
      <div className="line-letter-location line-letter-location-active" data-testid="letter-location-active">
        <div className="line-letter-location-copy">
          <span className="line-letter-location-icon"><LocateFixed size={15} strokeWidth={1.4} /></span>
          <div>
            <span className="line-mono line-letter-kicker">DROP LOCATION</span>
            <strong>Your current location</strong>
            <span className="line-letter-accuracy">
              Location accuracy: approximately {Math.max(1, Math.round(activeLocation.accuracy))}m
            </span>
          </div>
        </div>
        <button
          type="button"
          className="line-letter-location-refresh"
          onClick={location.requestLocation}
          disabled={location.loading}
          aria-label="Refresh drop location"
          data-testid="button-letter-refresh-location"
        >
          <RefreshCw size={14} strokeWidth={1.4} className={location.loading ? 'line-refresh-spinning' : ''} />
        </button>
      </div>
    );
  }

  return (
    <div className="line-letter-location line-letter-location-needed" data-testid="letter-location-needed">
      <div className="line-letter-location-copy">
        <span className="line-letter-location-icon"><LocateFixed size={15} strokeWidth={1.4} /></span>
        <div>
          <span className="line-mono line-letter-kicker">DROP LOCATION</span>
          <strong>LINE needs your location before you can leave a letter.</strong>
          <span className="line-letter-accuracy">
            {isRequesting
              ? 'Waiting for your device location…'
              : 'Your location stays private and is used only for this session.'}
          </span>
        </div>
      </div>
      <button
        type="button"
        className="line-letter-location-action line-mono"
        onClick={location.requestLocation}
        disabled={location.loading || !location.isSupported}
        data-testid="button-letter-enable-location"
      >
        {isRequesting ? 'Locating' : actionLabel}
      </button>
    </div>
  );
}

function LetterNote({ text }: { text: string }) {
  return (
    <article className="line-letter-note-card" data-testid="card-letter-preview">
      <div className="line-letter-note-topline line-mono">
        <span>ANONYMOUS</span>
        <span>LINE / 001</span>
      </div>
      <div className="line-letter-note-rule" />
      <p className="line-letter-note-text">{text}</p>
      <div className="line-letter-note-signature">— someone who was here</div>
      <div className="line-letter-note-edge" aria-hidden="true" />
    </article>
  );
}

function CompleteState({ onClose }: { onClose: () => void }) {
  return (
    <div className="line-letter-complete line-view-enter" data-testid="screen-letter-complete">
      <div className="line-letter-complete-mark" aria-hidden="true">
        <Check size={28} strokeWidth={1.2} />
      </div>
      <span className="line-section-index line-mono">SIGNAL LEFT / 001</span>
      <h1 className="line-letter-complete-title line-serif">LETTER LEFT.</h1>
      <p className="line-letter-complete-lead">Someone nearby may find it.</p>
      <p className="line-letter-complete-detail">Your letter is now tied to this place.</p>
      <div className="line-letter-local-note">
        <ShieldCheck size={15} strokeWidth={1.3} />
        <span className="line-mono">DELIVERED / DISCOVERABLE WITHIN 100M</span>
      </div>
      <button type="button" className="line-letter-return line-mono" onClick={onClose} data-testid="button-return-discover">
        Return to Discover
        <ArrowLeft size={15} strokeWidth={1.4} />
      </button>
    </div>
  );
}

export function LetterComposer({ location, onClose }: LetterComposerProps) {
  const [stage, setStage] = useState<ComposerStage>('write');
  const [text, setText] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showEmptyError, setShowEmptyError] = useState(false);
  const [letterId, setLetterId] = useState(() => createLetterId());

  const trimmedText = text.trim();
  const hasLocation = location.status === 'active' && location.location !== null;
  const canPreview = trimmedText.length > 0;
  const canDrop = canPreview && hasLocation;

  const previewLetter = () => {
    if (!canPreview) {
      setShowEmptyError(true);
      return;
    }

    setShowEmptyError(false);
    setStage('preview');
  };

  const beginPlacement = () => {
    if (!canDrop || !location.location) return;
    setStage('placement');
  };

  return (
    <section className="line-letter-composer" data-testid="screen-letter-composer">
      {stage !== 'placement' && (
        <header className="line-letter-composer-header">
          <span className="line-mono">DROP / 001</span>
          <button type="button" className="line-letter-close" onClick={onClose} aria-label="Close letter composer" data-testid="button-close-letter-composer">
            <X size={17} strokeWidth={1.4} />
          </button>
        </header>
      )}

      {stage === 'placement' ? (
        <DropPlacement
          letterId={letterId}
          text={trimmedText}
          location={location}
          onSuccess={() => setStage('complete')}
          onCancel={() => {
            setLetterId(createLetterId());
            setStage('preview');
          }}
        />
      ) : stage === 'complete' ? (
        <CompleteState onClose={onClose} />
      ) : (
        <div className="line-letter-composer-content">
          <div className="line-letter-composer-heading">
            <span className="line-section-index line-mono">{stage === 'write' ? 'WRITE / 01' : 'PREVIEW / 02'}</span>
            <h1 className="line-letter-composer-title line-serif">
              {stage === 'write' ? <>Leave something<br /><em>behind.</em></> : <>Read it once<br /><em>before it goes.</em></>}
            </h1>
            <p>{stage === 'write' ? 'Write something. Leave it somewhere.' : 'A small signal, made physical.'}</p>
          </div>

          {stage === 'write' ? (
            <>
              <div className="line-letter-paper-input">
                <div className="line-letter-paper-heading line-mono">
                  <span>ANONYMOUS NOTE</span>
                  <span>{text.length} / 500</span>
                </div>
                <textarea
                  value={text}
                  maxLength={500}
                  onChange={(event) => {
                    setText(event.target.value);
                    if (event.target.value.trim()) setShowEmptyError(false);
                  }}
                  placeholder="Dear stranger…"
                  aria-label="Write your anonymous letter"
                  data-testid="input-letter-text"
                />
                <div className="line-letter-paper-footer line-mono">
                  <span>Your words stay yours.</span>
                  <span>500 CHARACTER LIMIT</span>
                </div>
              </div>

              <div className="line-letter-anonymous">
                <div className="line-letter-anonymous-mark"><ShieldCheck size={16} strokeWidth={1.3} /></div>
                <div>
                  <span className="line-mono">ANONYMOUS</span>
                  <p>Your identity won’t be shown with this letter.</p>
                </div>
              </div>

              <div className="line-letter-settings">
                <button
                  type="button"
                  className={`line-letter-settings-toggle ${settingsOpen ? 'line-letter-settings-toggle-open' : ''}`}
                  onClick={() => setSettingsOpen((open) => !open)}
                  aria-expanded={settingsOpen}
                  data-testid="button-letter-settings"
                >
                  <span className="line-mono">LETTER SETTINGS</span>
                  <ChevronDown size={15} strokeWidth={1.3} />
                </button>
                {settingsOpen && (
                  <div className="line-letter-settings-content line-view-enter">
                    <div className="line-letter-visibility-row">
                      <div>
                        <span className="line-mono">VISIBILITY</span>
                        <p>Anyone nearby</p>
                      </div>
                      <span className="line-letter-selected"><Check size={13} strokeWidth={1.5} /> SELECTED</span>
                    </div>
                    <div className="line-letter-visibility-disabled">
                      <span>Specific people</span>
                      <span className="line-mono">COMING LATER</span>
                    </div>
                  </div>
                )}
              </div>

              <LetterLocation location={location} />

              {showEmptyError && <p className="line-letter-form-error" role="alert">Your letter is empty.</p>}

              <button type="button" className="line-letter-next line-mono" onClick={previewLetter} data-testid="button-preview-letter">
                Preview letter
                <FilePenLine size={15} strokeWidth={1.4} />
              </button>
            </>
          ) : (
            <>
              <LetterNote text={text} />
              <LetterLocation location={location} />
              {!hasLocation && <p className="line-letter-drop-note">LINE needs an active location before this letter can be left.</p>}
              <div className="line-letter-preview-actions">
                <button type="button" className="line-letter-back line-mono" onClick={() => setStage('write')} data-testid="button-edit-letter">
                  <ArrowLeft size={15} strokeWidth={1.4} />
                  Edit letter
                </button>
                <button type="button" className="line-letter-drop line-mono" onClick={beginPlacement} disabled={!canDrop} data-testid="button-drop-letter">
                  DROP THIS LINE
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
