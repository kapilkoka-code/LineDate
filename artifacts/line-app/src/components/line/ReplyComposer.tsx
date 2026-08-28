import { ArrowLeft, Check, FilePenLine, LocateFixed, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';
import type { LocationData } from '@/hooks/useLocation';
import {
  distanceBetweenLocations,
  isLetterWithinUnlockRange,
  UNLOCK_DISTANCE_METERS,
  type NearbyLetter,
} from '@/services/discovery';
import { getOrCreateLocalUser } from '@/services/identity';
import { createReplyId, getLocalSenderId, saveReply } from '@/services/replies';

type ReplyComposerProps = {
  letter: NearbyLetter;
  currentLocation: LocationData | null;
  locationAccuracy: number | null;
  loading: boolean;
  onRefresh: () => void;
  onClose: () => void;
};

type ReplyStage = 'write' | 'preview' | 'complete';

function formatDistance(distanceMeters: number | null) {
  return distanceMeters === null ? '—' : `${Math.max(1, Math.round(distanceMeters))}m`;
}

export function ReplyComposer({
  letter,
  currentLocation,
  locationAccuracy,
  loading,
  onRefresh,
  onClose,
}: ReplyComposerProps) {
  const [stage, setStage] = useState<ReplyStage>('write');
  const [text, setText] = useState('');
  const [showEmptyError, setShowEmptyError] = useState(false);
  const [proximityError, setProximityError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [localUser] = useState(() => getOrCreateLocalUser());
  const [senderId] = useState(() => getLocalSenderId());

  const distance = currentLocation
    ? distanceBetweenLocations(currentLocation, letter.letter)
    : null;
  const isUnlocked = isLetterWithinUnlockRange(currentLocation, letter.letter);
  const isInaccurate = locationAccuracy !== null && locationAccuracy > UNLOCK_DISTANCE_METERS;
  const trimmedText = text.trim();

  const showPreview = () => {
    if (!trimmedText) {
      setShowEmptyError(true);
      return;
    }

    setShowEmptyError(false);
    setProximityError(null);
    setStage('preview');
  };

  const sendReply = () => {
    setProximityError(null);
    setSaveError(null);

    if (!isUnlocked || letter.letter.isOwn === true) {
      setProximityError('You need to be within 10m of this letter to send a reply.');
      return;
    }

    setSaving(true);
    try {
      saveReply({
        id: createReplyId(),
        letterId: letter.id,
        text: trimmedText,
        createdAt: new Date().toISOString(),
        senderId,
        senderDisplayName: localUser.displayName,
        senderUserId: localUser.id,
        letterWriterId: letter.letter.writerId,
        letterWriterDisplayName: letter.letter.writerDisplayName,
        identityRevealed: false,
        status: 'sent',
      });
      setStage('complete');
    } catch {
      setSaveError('LINE couldn’t save this reply on your device. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="line-reply-composer line-view-enter" data-testid="screen-reply-composer">
      <header className="line-letter-composer-header">
        <span className="line-mono">REPLY / 001</span>
        <button type="button" className="line-letter-close" onClick={onClose} aria-label="Close reply composer" data-testid="button-close-reply-composer">
          <X size={17} strokeWidth={1.4} />
        </button>
      </header>

      {stage === 'complete' ? (
        <div className="line-reply-complete line-view-enter" data-testid="screen-reply-complete">
          <div className="line-letter-complete-mark" aria-hidden="true">
            <Check size={28} strokeWidth={1.2} />
          </div>
          <span className="line-section-index line-mono">SIGNAL SENT / LOCAL</span>
          <h1 className="line-letter-complete-title line-serif">REPLY SENT.</h1>
          <p className="line-letter-complete-lead">Your reply has been left for them.</p>
          <p className="line-letter-complete-detail">It hasn’t been delivered yet.</p>
          <div className="line-letter-local-note">
            <ShieldAlert size={15} strokeWidth={1.3} />
            <span className="line-mono">LOCAL PROTOTYPE / NOT DELIVERED</span>
          </div>
          <button type="button" className="line-letter-return line-mono" onClick={onClose} data-testid="button-return-after-reply">
            Return to the letter
            <ArrowLeft size={15} strokeWidth={1.4} />
          </button>
        </div>
      ) : (
        <div className="line-reply-content">
          <div className="line-letter-composer-heading">
            <span className="line-section-index line-mono">{stage === 'write' ? 'REPLY / 01' : 'PREVIEW / 02'}</span>
            <h1 className="line-letter-composer-title line-serif">
              {stage === 'write' ? <>Write a<br /><em>reply.</em></> : <>Send it<br /><em>back.</em></>}
            </h1>
            <p>{stage === 'write' ? 'Say something to the person who left it.' : 'A small answer, before it goes.'}</p>
          </div>

          {stage === 'write' ? (
            <>
              <div className="line-letter-paper-input line-reply-paper">
                <div className="line-letter-paper-heading line-mono">
                  <span>PRIVATE REPLY</span>
                  <span>{text.length} / 500</span>
                </div>
                <textarea
                  value={text}
                  maxLength={500}
                  onChange={(event) => {
                    setText(event.target.value);
                    if (event.target.value.trim()) setShowEmptyError(false);
                  }}
                  placeholder="I found your note…"
                  aria-label="Write your reply"
                  data-testid="input-reply-text"
                />
                <div className="line-letter-paper-footer line-mono">
                  <span>500 CHARACTER LIMIT</span>
                  <span>SENDER ID ATTACHED</span>
                </div>
              </div>
              <div className="line-reply-identity">
                <span className="line-reply-identity-mark line-mono">ID</span>
                <div>
                  <span className="line-mono">TEMPORARY SENDER ID</span>
                  <strong className="line-mono">{senderId}</strong>
                  <p>The writer will eventually see this private ID, not your name.</p>
                </div>
              </div>
              {showEmptyError && <p className="line-letter-form-error" role="alert">Your reply is empty.</p>}
              <button type="button" className="line-letter-next line-mono" onClick={showPreview} data-testid="button-preview-reply">
                Preview reply
                <FilePenLine size={15} strokeWidth={1.4} />
              </button>
            </>
          ) : (
            <>
              <article className="line-reply-note-card" data-testid="card-reply-preview">
                <div className="line-letter-note-topline line-mono">
                  <span>REPLY / PRIVATE</span>
                  <span>{senderId}</span>
                </div>
                <div className="line-letter-note-rule" />
                <p>{text}</p>
                <div className="line-letter-note-signature">— someone who found it</div>
              </article>

              <div className={`line-reply-proximity ${isUnlocked ? 'line-reply-proximity-active' : ''}`} data-testid="reply-proximity-state">
                <LocateFixed size={15} strokeWidth={1.3} />
                <div>
                  <span className="line-mono">{isUnlocked ? 'WITHIN RANGE' : 'OUT OF RANGE'}</span>
                  <strong>{formatDistance(distance)} away</strong>
                  {isInaccurate && <small>GPS may be imprecise at ±{Math.round(locationAccuracy!)}m.</small>}
                </div>
                <button type="button" onClick={onRefresh} disabled={loading} aria-label="Refresh reply proximity" data-testid="button-refresh-reply-proximity">
                  <RefreshCw size={13} strokeWidth={1.4} className={loading ? 'line-refresh-spinning' : ''} />
                </button>
              </div>

              {proximityError && <p className="line-letter-form-error" role="alert">{proximityError}</p>}
              {saveError && <p className="line-letter-form-error" role="alert">{saveError}</p>}
              {!isUnlocked && !proximityError && <p className="line-letter-drop-note">Move back within 10m before sending this reply.</p>}

              <div className="line-letter-preview-actions">
                <button type="button" className="line-letter-back line-mono" onClick={() => setStage('write')} data-testid="button-edit-reply">
                  <ArrowLeft size={15} strokeWidth={1.4} />
                  Edit reply
                </button>
                <button type="button" className="line-letter-drop line-mono" onClick={sendReply} disabled={!isUnlocked || saving} data-testid="button-send-reply">
                  {saving ? 'Sending…' : 'Send reply'}
                  <LocateFixed size={15} strokeWidth={1.4} />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}