import type { CSSProperties } from 'react';
import { getSpatialLineMetrics } from '@/services/spatialLine';

type CinematicLineProps = {
  letterId: string;
  distanceMeters: number;
  bearing: number;
  isUnlocked: boolean;
  intensity: number;
  beamOpacity: number;
  atmosphereOpacity: number;
  scale: number;
  horizontalPosition: number;
  secondary?: boolean;
  tertiary?: boolean;
  pulse?: boolean;
  confidence?: 'high' | 'medium' | 'low' | 'unavailable';
  isNight?: boolean;
  onOpen?: () => void;
};

export function CinematicLine({
  letterId,
  distanceMeters,
  bearing,
  isUnlocked,
  intensity,
  beamOpacity = 0,
  atmosphereOpacity = 0,
  scale,
  horizontalPosition,
  secondary = false,
  tertiary = false,
  pulse = false,
  confidence = 'high',
  isNight = false,
  onOpen,
}: CinematicLineProps) {
  const roundedDistance = Math.max(1, Math.round(distanceMeters));
  const metrics = getSpatialLineMetrics(distanceMeters, scale, isNight);

  const style = {
    '--find-x': horizontalPosition,
    '--find-intensity': intensity,
    '--find-beam-opacity': beamOpacity,
    '--find-atmosphere-opacity': atmosphereOpacity,
    '--find-scale-x': metrics.scaleX,
    '--find-scale-y': metrics.scaleY,
    '--find-core-opacity': metrics.coreOpacity,
    '--find-haze-opacity': metrics.hazeOpacity,
  } as CSSProperties;

  return (
    <article
      className={[
        'line-cinematic-line',
        isUnlocked ? 'line-cinematic-line-unlocked' : '',
        secondary ? 'line-cinematic-line-secondary' : '',
        tertiary ? 'line-cinematic-line-tertiary' : '',
        pulse ? 'line-cinematic-line-pulse' : '',
        isNight ? 'line-cinematic-night' : 'line-cinematic-day',
        `line-confidence-${confidence}`,
      ].filter(Boolean).join(' ')}
      style={style}
      aria-label={`Anonymous letter approximately ${roundedDistance} meters away.${isUnlocked ? ' The letter is unlocked.' : ''}`}
      data-bearing={Math.round(bearing)}
      data-beam-opacity={beamOpacity.toFixed(3)}
      data-atmosphere-opacity={atmosphereOpacity.toFixed(3)}
      data-testid={`signal-beam-${letterId}`}
    >
      <div className="line-cinematic-atmosphere" aria-hidden="true">
        <div className="line-cinematic-base-glow" />
      </div>
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
