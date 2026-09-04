export type ArCapabilityState =
  | 'WORLD_AR_SUPPORTED'
  | 'SENSOR_SPATIAL_MODE'
  | 'CAMERA_ONLY'
  | 'MAP_FALLBACK';

export type WorldArSupport = 'checking' | 'supported' | 'unsupported';

type XRSystemLike = {
  isSessionSupported: (mode: 'immersive-ar') => Promise<boolean>;
};

function getXRSystem() {
  return (navigator as Navigator & { xr?: XRSystemLike }).xr;
}

export async function detectWorldArSupport(): Promise<Exclude<WorldArSupport, 'checking'>> {
  if (!window.isSecureContext) return 'unsupported';
  const xr = getXRSystem();
  if (!xr?.isSessionSupported) return 'unsupported';

  try {
    return await xr.isSessionSupported('immersive-ar') ? 'supported' : 'unsupported';
  } catch {
    return 'unsupported';
  }
}

export function selectArCapability({
  worldArSupport,
  cameraAvailable,
  trustedHeadingAvailable,
}: {
  worldArSupport: WorldArSupport;
  cameraAvailable: boolean;
  trustedHeadingAvailable: boolean;
}): ArCapabilityState {
  if (!cameraAvailable) return 'MAP_FALLBACK';
  if (worldArSupport === 'supported' && trustedHeadingAvailable) return 'WORLD_AR_SUPPORTED';
  if (trustedHeadingAvailable) return 'SENSOR_SPATIAL_MODE';
  return 'CAMERA_ONLY';
}