import type { SpatialConfidence, SpatialTrackingState } from './types';

export type SpatialConfidenceInput = {
  trackingState: SpatialTrackingState;
  gpsAccuracyMeters: number | null;
  gpsAgeMs: number | null;
  headingStable: boolean;
  anchorMatch: 'unknown' | 'weak' | 'strong';
  candidateAmbiguous: boolean;
};

export function evaluateSpatialConfidence(input: SpatialConfidenceInput): SpatialConfidence {
  if (input.trackingState === 'idle' || input.trackingState === 'lost') return 'unavailable';
  if (input.candidateAmbiguous) return 'low';
  if (input.gpsAgeMs !== null && input.gpsAgeMs > 45_000) return 'low';
  if (input.gpsAccuracyMeters !== null && input.gpsAccuracyMeters > 35) return 'low';
  if (input.anchorMatch === 'strong' && input.trackingState === 'verified') return 'verified';
  if (input.anchorMatch === 'strong' && input.headingStable) return 'high';
  if (input.anchorMatch === 'weak' || !input.headingStable) return 'medium';
  return 'low';
}
