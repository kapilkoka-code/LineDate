import type { GeographicHint, SpatialAdapterKind, Transform3D, Vector3 } from './types';

export type SpatialAnchorFrameDraft = {
  schemaVersion: 1;
  adapter: SpatialAdapterKind;
  geographicHint: GeographicHint;
  anchorPosition: Vector3;
  entityTransform?: Transform3D;
  capturedAt: number;
};

/**
 * Produces an in-memory draft only.
 *
 * Persistence is intentionally deferred until real-device testing establishes
 * which evidence is reliable enough to become part of LINE's durable schema.
 */
export function createSpatialAnchorFrameDraft(input: Omit<SpatialAnchorFrameDraft, 'schemaVersion' | 'capturedAt'>): SpatialAnchorFrameDraft {
  return {
    schemaVersion: 1,
    capturedAt: Date.now(),
    ...input,
  };
}
