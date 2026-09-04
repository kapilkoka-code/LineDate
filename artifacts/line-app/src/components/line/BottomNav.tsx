import { Aperture, Compass, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';

export type AppView = 'discover' | 'camera' | 'redline' | 'profile';

type BottomNavProps = {
  activeView: AppView;
  onChange: (view: AppView) => void;
};

type NavItemProps = {
  view: AppView;
  label: string;
  activeView: AppView;
  onChange: (view: AppView) => void;
  icon: ReactNode;
};

function NavItem({ view, label, activeView, onChange, icon }: NavItemProps) {
  const active = view === activeView;
  return (
    <button
      type="button"
      onClick={() => onChange(view)}
      className={`line-nav-item ${active ? 'line-nav-item-active' : ''}`}
      data-testid={`button-nav-${view}`}
      aria-label={`Open ${label}`}
      aria-current={active ? 'page' : undefined}
    >
      <span className="line-nav-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

export function BottomNav({ activeView, onChange }: BottomNavProps) {
  return (
    <nav className="line-bottom-nav" aria-label="Primary navigation" data-testid="navigation-primary">
      <NavItem view="discover" label="HOME" activeView={activeView} onChange={onChange} icon={<Compass size={17} strokeWidth={1.5} />} />
      <NavItem view="camera" label="FIND" activeView={activeView} onChange={onChange} icon={<Aperture size={17} strokeWidth={1.5} />} />
      <NavItem view="redline" label="MY LETTERS" activeView={activeView} onChange={onChange} icon={<span className="line-nav-redline-icon" />} />
      <NavItem view="profile" label="PROFILE" activeView={activeView} onChange={onChange} icon={<UserRound size={17} strokeWidth={1.5} />} />
    </nav>
  );
}