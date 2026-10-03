import type { Vector3 } from './types';

export type PhysicalRediscoveryMeasurement = {
  translationErrorMeters: number;
  expected: Vector3;
  observed: Vector3;
  recordedAt: number;
};

export function distance3d(a: Vector3, b: Vector3) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function measurePhysicalRediscoveryError(
  expected: Vector3,
  observed: Vector3,
  recordedAt = Date.now(),
): PhysicalRediscoveryMeasurement {
  return {
    translationErrorMeters: distance3d(expected, observed),
    expected,
    observed,
    recordedAt,
  };
}

export type SpatialDiagnosticSample = {
  recordedAt: number;
  cameraPosition: Vector3 | null;
  anchorPosition: Vector3 | null;
  trackingState: string;
  trackingLosses: number;
  framesPerSecond: number | null;
};

export function createSpatialDiagnosticSample(input: Omit<SpatialDiagnosticSample, 'recordedAt'>): SpatialDiagnosticSample {
  return {
    recordedAt: Date.now(),
    ...input,
  };
}
