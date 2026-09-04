import type { CSSProperties } from 'react';

type CinematicLineProps = {
  letterId: string;
  distanceMeters: number;
  bearing: number;
  isUnlocked: boolean;
  intensity: number;
  opacity: number;
  scale: number;
  horizontalPosition: number;
  secondary?: boolean;
  pulse?: boolean;
  onOpen?: () => void;
};

export function CinematicLine({
  letterId,
  distanceMeters,
  bearing,
  isUnlocked,
  intensity,
  opacity,
  scale,
  horizontalPosition,
  secondary = false,
  pulse = false,
  onOpen,
}: CinematicLineProps) {
  const roundedDistance = Math.max(1, Math.round(distanceMeters));
  const style = {
    '--find-x': `${horizontalPosition}%`,
    '--find-intensity': intensity,
    '--find-opacity': opacity,
    '--find-scale': scale,
  } as CSSProperties;

  return (
    <article
      className={[
        'line-cinematic-line',
        isUnlocked ? 'line-cinematic-line-unlocked' : '',
        secondary ? 'line-cinematic-line-secondary' : '',
        pulse ? 'line-cinematic-line-pulse' : '',
      ].filter(Boolean).join(' ')}
      style={style}
      aria-label={`Anonymous letter approximately ${roundedDistance} meters away.${isUnlocked ? ' The letter is unlocked.' : ''}`}
      data-bearing={Math.round(bearing)}
      data-testid={`signal-beam-${letterId}`}
    >
      <div className="line-cinematic-atmosphere" aria-hidden="true" />
      <div className="line-cinematic-beam-pair" aria-hidden="true">
        {[0, 1].map((beam) => (
          <div className="line-cinematic-beam" key={beam}>
            <span className="line-cinematic-beam-haze" />
            <span className="line-cinematic-beam-soft" />
            <span className="line-cinematic-beam-core" />
            <span className="line-cinematic-beam-glow" />
            <span className="line-cinematic-particles" />
          </div>
        ))}
      </div>
      <div className="line-cinematic-caption">
        <strong className="line-serif">{roundedDistance} m</strong>
        {isUnlocked ? (
          <button
            type="button"
            className="line-cinematic-open line-mono"
            onClick={onOpen}
            data-testid={`button-interact-signal-${letterId}`}
          >
            Open letter
          </button>
        ) : (
          <span className="line-mono">Anonymous signal</span>
        )}
      </div>
    </article>
  );
}