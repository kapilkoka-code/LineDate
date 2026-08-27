type LineMarkProps = {
  compact?: boolean;
  light?: boolean;
};

export function LineMark({ compact = false, light = false }: LineMarkProps) {
  return (
    <div
      aria-label="LINE"
      className={`line-mark ${compact ? 'line-mark-compact' : ''} ${light ? 'line-mark-light' : ''}`}
      data-testid="brand-line-mark"
    >
      <span className="line-mark-word">LINE</span>
      <span className="line-mark-rule" aria-hidden="true" />
    </div>
  );
}