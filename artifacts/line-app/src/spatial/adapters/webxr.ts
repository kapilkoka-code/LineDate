/**
 * WebXR remains LINE's browser spatial adapter.
 *
 * This adapter intentionally preserves the existing session-local behavior while
 * the Spatial Engine is introduced. It must not be interpreted as persistent
 * cross-device physical localization.
 */
export {
  startWorldArSession,
  type WorldArController,
  type WorldArDiagnostics,
  type WorldArEndReason,
  type WorldArSignal,
  type WorldArTrackingState,
} from '@/services/worldArSession';
