import type { SpatialTrackingState } from './types';

export type SpatialEvent =
  | 'START_SEARCH'
  | 'CANDIDATE_FOUND'
  | 'LOCALIZED'
  | 'VERIFY'
  | 'TRACKING_LOST'
  | 'RESET';

export function nextSpatialState(
  state: SpatialTrackingState,
  event: SpatialEvent,
): SpatialTrackingState {
  if (event === 'RESET') return 'idle';
  if (event === 'TRACKING_LOST') return state === 'idle' ? 'idle' : 'lost';

  switch (state) {
    case 'idle':
      return event === 'START_SEARCH' ? 'searching' : state;
    case 'searching':
      return event === 'CANDIDATE_FOUND' ? 'possible' : state;
    case 'possible':
      return event === 'LOCALIZED' ? 'localized' : state;
    case 'localized':
      return event === 'VERIFY' ? 'verified' : state;
    case 'verified':
      return state;
    case 'lost':
      return event === 'START_SEARCH' ? 'searching' : state;
  }
}
