export type SpatialLineMetrics = {
  depthFactor: number;
  scaleX: number;
  scaleY: number;
  coreOpacity: number;
  hazeOpacity: number;
};

export function getSpatialLineMetrics(
  distanceMeters: number,
  baseScale: number,
  isNight: boolean,
): SpatialLineMetrics {
  const depthFactor = Math.max(0, Math.min(1, (100 - distanceMeters) / 95));
  return {
    depthFactor,
    scaleX: baseScale * (0.4 + depthFactor * 0.8),
    scaleY: 0.7 + depthFactor * 0.5,
    coreOpacity: 0.2 + depthFactor * 0.8,
    hazeOpacity: isNight ? 0.4 + depthFactor * 0.6 : 0.1 + depthFactor * 0.3,
  };
}