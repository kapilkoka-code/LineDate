export type SpatialTrackingState = 'idle' | 'searching' | 'possible' | 'localized' | 'verified' | 'lost';

export type SpatialConfidence = 'unavailable' | 'low' | 'medium' | 'high' | 'verified';

export type SpatialAdapterKind = 'webxr' | 'arkit' | 'arcore' | 'sensor';

export type Vector3 = { x: number; y: number; z: number };

export type Quaternion = { x: number; y: number; z: number; w: number };

export type Transform3D = {
  position: Vector3;
  orientation: Quaternion;
};

export type GeographicHint = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  observedAt: number;
};

export type SpatialEvidence = {
  adapter: SpatialAdapterKind;
  geographicHint: GeographicHint;
  anchorTransform?: Transform3D;
  entityTransform?: Transform3D;
  trackingQuality?: 'unavailable' | 'limited' | 'normal';
  metadata?: Record<string, unknown>;
};

export type SpatialSnapshot = {
  trackingState: SpatialTrackingState;
  confidence: SpatialConfidence;
  adapter: SpatialAdapterKind | null;
  anchorLocked: boolean;
  trackingLosses: number;
};
