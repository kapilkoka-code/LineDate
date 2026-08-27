import { ArrowUpRight, ChevronRight, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { DiscoveryLetter } from '@/data/discovery';
import { BottomNav, type AppView } from '@/components/line/BottomNav';
import { DiscoveryField } from '@/components/line/DiscoveryField';
import { LineMark } from '@/components/line/LineMark';

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

function DiscoverView() {
  const [selectedLetter, setSelectedLetter] = useState<DiscoveryLetter | null>(null);

  return (
    <div className="line-view line-discover-view">
      <header className="line-app-header">
        <LineMark compact />
        <span className="line-header-status line-mono"><span className="line-status-dot" />LIVE PROTOTYPE</span>
      </header>
      <div className="line-view-heading">
        <div>
          <span className="line-section-index line-mono">01 / DISCOVER</span>
          <h1 className="line-view-title line-serif">Find what’s<br /><em>left behind.</em></h1>
        </div>
        <p className="line-view-caption">A soft map of the<br />signals around you.</p>
      </div>
      <DiscoveryField selectedLetter={selectedLetter} onSelect={setSelectedLetter} onDismiss={() => setSelectedLetter(null)} />
      <div className="line-discover-footnote line-mono"><span>3 SIGNALS IN RANGE</span><span>FICTIONAL FIELD / 001</span></div>
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

function ProfileView() {
  const [activeRow, setActiveRow] = useState<string | null>(null);

  return (
    <div className="line-view line-profile-view">
      <header className="line-app-header">
        <LineMark compact />
        <span className="line-header-index line-mono">04 / PRIVATE</span>
      </header>
      <div className="line-profile-intro">
        <span className="line-section-index line-mono">YOUR PROFILE</span>
        <h1 className="line-profile-title line-serif">Anonymous<br /><em>User</em></h1>
        <div className="line-private-note"><ShieldCheck size={15} strokeWidth={1.4} /><span>Your identity is private.</span></div>
      </div>
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
      <div className="line-profile-footer line-mono">PRIVATE BY DEFAULT / ALWAYS</div>
    </div>
  );
}

function AppViewContent({ activeView }: { activeView: AppView }) {
  if (activeView === 'camera') return <CameraView />;
  if (activeView === 'redline') return <RedlineView />;
  if (activeView === 'profile') return <ProfileView />;
  return <DiscoverView />;
}

function AppShell() {
  const [activeView, setActiveView] = useState<AppView>('discover');

  return (
    <main className="line-shell line-mobile-frame" data-testid="screen-app-shell">
      <div className="line-shell-content" key={activeView}>
        <AppViewContent activeView={activeView} />
      </div>
      <BottomNav activeView={activeView} onChange={setActiveView} />
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