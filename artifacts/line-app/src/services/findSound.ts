export type FindSoundCue = 'startup' | 'approaching' | 'unlock';

export function playFindSound(_cue: FindSoundCue) {
  // Intentionally silent until spatial audio is introduced. Keeping the cue
  // boundary here lets FIND add opt-in audio later without coupling it to UI.
}