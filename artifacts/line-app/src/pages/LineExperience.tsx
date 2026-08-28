import { ArrowUpRight, ChevronRight, FileText, LockKeyhole, PenLine, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BottomNav, type AppView } from '@/components/line/BottomNav';
import { DiscoveryField } from '@/components/line/DiscoveryField';
import { LineMark } from '@/components/line/LineMark';
import { LetterComposer } from '@/components/line/LetterComposer';
import { LocationHeaderStatus, LocationPanel } from '@/components/line/LocationPanel';
import { useLocation, type LocationState } from '@/hooks/useLocation';
import { getNearbyLetters, type NearbyLetter } from '@/services/discovery';
import { loadLetters, type Letter } from '@/services/letters';
import { loadReplies, type LetterReply } from '@/services/replies';

const profileRows = ['Privacy', 'Notifications', 'Location', 'Safety', 'Account'];

function OpeningScreen({ onEnter }: { onEnter: () => void }) {
  const [leaving, setLeaving] = useState(false);

  const enterLine = () => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(onEnter, 360);
  };

  return (
    <main className={`line-opening line-mobile-frame ${leaving ? 'line-screen-exit' : ''}`} data-testid="screen-opening">
      <div className="line-opening-vert" aria-hidden="true" />
      <div className="line-opening-topline line-mono line-reveal">
        <span>PRIVATE SIGNAL / 001</span>
        <span>EST. 2025</span>
      </div>
      <div className="line-opening-orbit" aria-hidden="true">
        <span className="line-orbit-ring line-orbit-ring-one" />
        <span className="line-orbit-ring line-orbit-ring-two" />
        <span className="line-orbit-point" />
      </div>
      <div className="line-opening-content">
        <div className="line-opening-brand line-reveal-delay">
          <LineMark light />
        </div>
        <p className="line-opening-tagline line-serif line-reveal-delay">Leave something behind.</p>
        <p className="line-opening-description line-reveal-late">
          Letters, places and people —<br />connected in the real world.
        </p>
        <button type="button" className="line-enter-button line-reveal-late" onClick={enterLine} disabled={leaving} data-testid="button-enter-line">
          <span>{leaving ? 'Opening signal' : 'Enter LINE'}</span>
          <ArrowUpRight size={18} strokeWidth={1.5} />
        </button>
      </div>
      <div className="line-opening-footer line-mono line-reveal-late">
        <span className="line-status"><span className="line-status-dot" />Signal is quiet</span>
        <span>Scroll to enter</span>
      </div>
    </main>
  );
}

function DiscoverView({ location, onDropLetter }: { location: LocationState; onDropLetter: () => void }) {
  const [selectedLetterId, setSelectedLetterId] = useState<string | null>(null);
  const [storedLetters, setStoredLetters] = useState<Letter[]>([]);

  useEffect(() => {
    setStoredLetters(loadLetters());
  }, [location.location]);

  const nearbyLetters = useMemo(
    () => getNearbyLetters(location.location, storedLetters),
    [location.location, storedLetters],
  );
  const locationReady = location.status === 'active' && location.location !== null;
  const selectedLetter = nearbyLetters.find((letter) => letter.id === selectedLetterId) ?? null;

  useEffect(() => {
    if (selectedLetterId && locationReady && !selectedLetter) {
      setSelectedLetterId(null);
    }
  }, [locationReady, selectedLetter, selectedLetterId]);

  return (
    <div className="line-view line-discover-view">
      <header className="line-app-header">
        <LineMark compact />
        <LocationHeaderStatus status={location.status} />
      </header>
      <div className="line-view-heading">
        <div>
          <span className="line-section-index line-mono">01 / DISCOVER</span>
          <h1 className="line-view-title line-serif">Find what’s<br /><em>left behind.</em></h1>
        </div>
        <p className="line-view-caption">Private signals —<br />within 100 metres.</p>
      </div>
      <LocationPanel location={location} />
      <button type="button" className="line-drop-letter" onClick={onDropLetter} data-testid="button-open-letter-composer">
        <span className="line-drop-letter-copy">
          <span className="line-mono">CREATE SIGNAL</span>
          <strong>Drop a letter</strong>
        </span>
        <PenLine size={17} strokeWidth={1.3} />
      </button>
      <DiscoveryField
        letters={nearbyLetters}
        selectedLetter={selectedLetter}
        locationStatus={location.status}
        locationReady={locationReady}
        currentLocation={location.location}
        locationAccuracy={location.location?.accuracy ?? null}
        loading={location.loading}
        onRefresh={location.requestLocation}
        onSelect={(letter) => setSelectedLetterId(letter.id)}
        onDismiss={() => setSelectedLetterId(null)}
      />
      <div className="line-discover-footnote line-mono">
        <span>{locationReady ? `${nearbyLetters.length} SIGNAL${nearbyLetters.length === 1 ? '' : 'S'} WITHIN 100M` : 'DISCOVERY STANDBY'}</span>
        <span>ANONYMOUS / COORDINATES HIDDEN</span>
      </div>
    </div>
  );
}

function CameraView() {
  const [held, setHeld] = useState(false);

  return (
    <div className="line-view line-camera-view">
      <header className="line-app-header">
        <LineMark compact />
        <span className="line-header-index line-mono">02 / FIELD LENS</span>
      </header>
      <div className="line-camera-copy">
        <span className="line-section-index line-mono">CAMERA / VISUAL PROTOTYPE</span>
        <h1 className="line-camera-title line-serif">THE WORLD IS<br /><em>FULL OF LETTERS.</em></h1>
        <p>AR discovery will appear here.</p>
      </div>
      <div className={`line-camera-stage ${held ? 'line-camera-stage-held' : ''}`}>
        <span className="line-camera-corner line-camera-corner-tl" aria-hidden="true" />
        <span className="line-camera-corner line-camera-corner-tr" aria-hidden="true" />
        <span className="line-camera-corner line-camera-corner-bl" aria-hidden="true" />
        <span className="line-camera-corner line-camera-corner-br" aria-hidden="true" />
        <span className="line-camera-crosshair" aria-hidden="true" />
        <button
          type="button"
          className="line-camera-button"
          onClick={() => setHeld((value) => !value)}
          aria-label="Hold visual camera signal"
          data-testid="button-camera-signal"
        >
          <span />
        </button>
        <span className="line-camera-hint line-mono">{held ? 'SIGNAL HELD / NO CAMERA ACCESS' : 'TAP TO HOLD THE SIGNAL'}</span>
      </div>
      <div className="line-camera-footer line-mono"><span>NO DEVICE ACCESS</span><span>VISUAL SHELL ONLY</span></div>
    </div>
  );
}

function RedlineView() {
  return (
    <div className="line-view line-redline-view">
      <header className="line-app-header">
        <LineMark compact />
        <span className="line-header-index line-mono">03 / CROWD SIGNAL</span>
      </header>
      <div className="line-redline-copy">
        <span className="line-section-index line-mono">REDLINE / PROTOTYPE</span>
        <h1 className="line-redline-title line-serif">Find someone<br /><em>in the crowd.</em></h1>
        <p>The nearest thread is still forming.</p>
      </div>
      <div className="line-redline-stage" aria-label="Animated red line approaching a signal point">
        <div className="line-redline-horizon" aria-hidden="true" />
        <div className="line-redline-path line-signal" aria-hidden="true" />
        <div className="line-redline-point line-signal" aria-hidden="true" />
        <div className="line-redline-label line-mono">SEARCHING / 001</div>
      </div>
      <div className="line-redline-note">
        <LockKeyhole size={15} strokeWidth={1.4} />
        <span>Nothing is being tracked.</span>
      </div>
    </div>
  );
}

function formatReplyDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'TIME UNKNOWN'
    : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function RepliesView({
  letter,
  replies,
  onBack,
}: {
  letter: Letter;
  replies: LetterReply[];
  onBack: () => void;
}) {
  return (
    <div className="line-replies-view line-view-enter" data-testid="screen-letter-replies">
      <div className="line-replies-heading">
        <button type="button" className="line-replies-back line-mono" onClick={onBack} data-testid="button-back-to-my-letters">
          <ChevronRight size={14} strokeWidth={1.4} />
          My letters
        </button>
        <span className="line-section-index line-mono">INBOX / LOCAL PROTOTYPE</span>
        <h1 className="line-replies-title line-serif">What came<br /><em>back.</em></h1>
        <p>Replies to this letter stay here for now.</p>
      </div>

      <div className="line-replies-source">
        <span className="line-mono">YOUR LETTER</span>
        <p>{letter.text}</p>
      </div>

      {replies.length === 0 ? (
        <div className="line-replies-empty" data-testid="state-no-replies">
          <span className="line-mono">NO REPLIES YET</span>
          <p>Maybe someone hasn’t found your letter.</p>
        </div>
      ) : (
        <div className="line-replies-list" aria-label="Replies to this letter" data-testid="list-letter-replies">
          {replies.map((reply) => (
            <article className="line-reply-inbox-card" key={reply.id} data-testid={`card-letter-reply-${reply.id}`}>
              <div className="line-reply-inbox-topline line-mono">
                <span>REPLY / {reply.status.toUpperCase()}</span>
                <span>{formatReplyDate(reply.createdAt)}</span>
              </div>
              <p>{reply.text}</p>
              <div className="line-reply-inbox-meta line-mono">
                <span>FROM TEMPORARY ID</span>
                <strong>{reply.senderId}</strong>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="line-replies-local-note">
        <ShieldCheck size={15} strokeWidth={1.3} />
        <span className="line-mono">LOCAL ONLY / REMOTE DELIVERY IS NOT ENABLED</span>
      </div>
    </div>
  );
}

function MyLetters({
  letters,
  replies,
  onSelectLetter,
}: {
  letters: Letter[];
  replies: LetterReply[];
  onSelectLetter: (letter: Letter) => void;
}) {
  if (letters.length === 0) {
    return (
      <div className="line-my-letters-empty line-view-enter" data-testid="panel-my-letters-empty">
        <FileText size={18} strokeWidth={1.2} />
        <p>You haven’t left anything behind yet.</p>
        <span>Maybe it’s time.</span>
      </div>
    );
  }

  return (
    <div className="line-my-letters-grid line-view-enter" aria-label="Letters you have left" data-testid="panel-my-letters">
      {letters.map((letter) => (
        <button
          type="button"
          className="line-my-letter-card"
          key={letter.id}
          onClick={() => onSelectLetter(letter)}
          data-testid={`card-my-letter-${letter.id}`}
        >
          <div className="line-my-letter-card-topline line-mono">
            <span>ANONYMOUS</span>
            <span>{replies.filter((reply) => reply.letterId === letter.id).length > 0 ? 'SOMEONE REPLIED' : 'NO REPLIES YET'}</span>
          </div>
          <p>{letter.text}</p>
          <div className="line-my-letter-meta line-mono">
            <span>{formatReplyDate(letter.createdAt)}</span>
            <span>LOCATION ACTIVE / ~{Math.max(1, Math.round(letter.accuracy))}m</span>
          </div>
          <span className="line-my-letter-action line-mono">
            {replies.some((reply) => reply.letterId === letter.id) ? 'VIEW REPLIES' : 'OPEN LETTER'}
            <ChevronRight size={13} strokeWidth={1.4} />
          </span>
        </button>
      ))}
    </div>
  );
}

function ProfileView() {
  const [activeRow, setActiveRow] = useState<string | null>(null);
  const [showMyLetters, setShowMyLetters] = useState(false);
  const [letters, setLetters] = useState<Letter[]>([]);
  const [replies, setReplies] = useState<LetterReply[]>([]);
  const [selectedLetterId, setSelectedLetterId] = useState<string | null>(null);

  useEffect(() => {
    if (showMyLetters) {
      setLetters(loadLetters().filter((letter) => letter.isOwn !== false));
      setReplies(loadReplies());
    }
  }, [showMyLetters]);

  const selectedLetter = letters.find((letter) => letter.id === selectedLetterId) ?? null;

  return (
    <div className="line-view line-profile-view">
      <header className="line-app-header">
        <LineMark compact />
        <span className="line-header-index line-mono">04 / PRIVATE</span>
      </header>
      {selectedLetter ? (
        <RepliesView
          letter={selectedLetter}
          replies={replies.filter((reply) => reply.letterId === selectedLetter.id)}
          onBack={() => setSelectedLetterId(null)}
        />
      ) : (
        <>
          <div className="line-profile-intro">
            <span className="line-section-index line-mono">YOUR PROFILE</span>
            <h1 className="line-profile-title line-serif">Anonymous<br /><em>User</em></h1>
            <div className="line-private-note"><ShieldCheck size={15} strokeWidth={1.4} /><span>Your identity is private.</span></div>
          </div>
          <button
            type="button"
            className={`line-my-letters-trigger ${showMyLetters ? 'line-my-letters-trigger-active' : ''}`}
            onClick={() => setShowMyLetters((open) => !open)}
            aria-expanded={showMyLetters}
            data-testid="button-my-letters"
          >
            <span className="line-my-letters-trigger-copy">
              <span className="line-mono">YOUR SIGNALS</span>
              <strong>My letters</strong>
            </span>
            <FileText size={17} strokeWidth={1.3} />
          </button>
          {showMyLetters && <MyLetters letters={letters} replies={replies} onSelectLetter={(letter) => setSelectedLetterId(letter.id)} />}
          <div className="line-profile-list" aria-label="Profile settings">
            {profileRows.map((row, index) => (
              <button
                type="button"
                key={row}
                className={`line-profile-row ${activeRow === row ? 'line-profile-row-active' : ''}`}
                onClick={() => setActiveRow(activeRow === row ? null : row)}
                data-testid={`button-profile-${row.toLowerCase()}`}
              >
                <span className="line-profile-row-number line-mono">0{index + 1}</span>
                <span>{row}</span>
                <ChevronRight size={16} strokeWidth={1.4} />
              </button>
            ))}
          </div>
          {activeRow && (
            <div className="line-profile-placeholder line-view-enter" data-testid="text-profile-placeholder">
              <span className="line-mono">PLACEHOLDER / {activeRow.toUpperCase()}</span>
              <p>This setting will be available in a future step.</p>
            </div>
          )}
        </>
      )}
      <div className="line-profile-footer line-mono">PRIVATE BY DEFAULT / ALWAYS</div>
    </div>
  );
}

function AppViewContent({
  activeView,
  location,
  onDropLetter,
}: {
  activeView: AppView;
  location: LocationState;
  onDropLetter: () => void;
}) {
  if (activeView === 'camera') return <CameraView />;
  if (activeView === 'redline') return <RedlineView />;
  if (activeView === 'profile') return <ProfileView />;
  return <DiscoverView location={location} onDropLetter={onDropLetter} />;
}

function AppShell() {
  const [activeView, setActiveView] = useState<AppView>('discover');
  const location = useLocation();
  const [composerOpen, setComposerOpen] = useState(false);
  const composerOpenRef = useRef(false);
  const historyEntryRef = useRef(false);
  const closingComposerRef = useRef(false);

  const closeComposer = useCallback(() => {
    if (!composerOpenRef.current) return;

    composerOpenRef.current = false;
    setComposerOpen(false);

    if (historyEntryRef.current) {
      historyEntryRef.current = false;
      closingComposerRef.current = true;
      window.history.back();
    }
  }, []);

  const openComposer = useCallback(() => {
    if (composerOpenRef.current) return;

    composerOpenRef.current = true;
    historyEntryRef.current = true;
    window.history.pushState({ lineLetterComposer: true }, '', window.location.href);
    setComposerOpen(true);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      if (closingComposerRef.current) {
        closingComposerRef.current = false;
        return;
      }

      if (!composerOpenRef.current) return;

      // Keep the full-screen composer in place when the browser back button
      // is pressed. The close control is the explicit way to leave the flow.
      window.history.pushState({ lineLetterComposer: true }, '', window.location.href);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return (
    <main className="line-shell line-mobile-frame" data-testid="screen-app-shell">
      {composerOpen ? (
        <LetterComposer location={location} onClose={closeComposer} />
      ) : (
        <>
          <div className="line-shell-content" key={activeView}>
            <AppViewContent
              activeView={activeView}
              location={location}
              onDropLetter={openComposer}
            />
          </div>
          <BottomNav activeView={activeView} onChange={setActiveView} />
        </>
      )}
    </main>
  );
}

export default function LineExperience() {
  const [entered, setEntered] = useState(false);

  return (
    <div className="line-app">
      <div className="line-grain" aria-hidden="true" />
      {entered ? <AppShell /> : <OpeningScreen onEnter={() => setEntered(true)} />}
    </div>
  );
}