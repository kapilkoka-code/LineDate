import { evaluateSpatialConfidence, type SpatialConfidenceInput } from './confidence';
import { nextSpatialState, type SpatialEvent } from './stateMachine';
import type { SpatialSnapshot, SpatialTrackingState } from './types';

export class SpatialEngine {
  private state: SpatialTrackingState = 'idle';
  private trackingLosses = 0;
  private adapter: SpatialSnapshot['adapter'] = null;

  setAdapter(adapter: SpatialSnapshot['adapter']) {
    this.adapter = adapter;
  }

  transition(event: SpatialEvent) {
    if (event === 'TRACKING_LOST' && this.state !== 'idle') this.trackingLosses += 1;
    this.state = nextSpatialState(this.state, event);
    return this.state;
  }

  snapshot(confidenceInput: Omit<SpatialConfidenceInput, 'trackingState'>): SpatialSnapshot {
    return {
      trackingState: this.state,
      confidence: evaluateSpatialConfidence({
        ...confidenceInput,
        trackingState: this.state,
      }),
      adapter: this.adapter,
      anchorLocked: this.state === 'localized' || this.state === 'verified',
      trackingLosses: this.trackingLosses,
    };
  }
}
