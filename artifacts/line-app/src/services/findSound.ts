import type { SensorConfidence } from '@/hooks/useOrientationController';

export type FindSoundCue = 'startup' | 'approaching' | 'unlock';
export type FindAudioProminence = 'primary' | 'secondary' | 'tertiary';
export type FindAudioLifecycle = 'idle' | 'starting' | 'running' | 'suspended' | 'disabled' | 'unavailable';

export type FindAudioSignal = {
  id: string;
  distanceMeters: number;
  angularDifference: number;
  prominence: FindAudioProminence;
  isUnlocked: boolean;
};

export type FindAudioScene = {
  active: boolean;
  confidence: SensorConfidence;
  reducedMotion: boolean;
  simulateUnavailable?: boolean;
  signals: FindAudioSignal[];
};

export type FindAudioDiagnostics = {
  enabled: boolean;
  capability: 'web-audio' | 'web-audio-centered' | 'unavailable';
  lifecycle: FindAudioLifecycle;
  angularDifference: number | null;
  pan: number;
  distanceMeters: number | null;
  intensity: number;
  confidence: SensorConfidence;
  activeVoices: number;
};

type AudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

type SignalVoice = {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  pan: StereoPannerNode | null;
  gain: GainNode;
  releaseToken: number;
};

const PROMINENCE_GAIN: Record<FindAudioProminence, number> = {
  primary: 1,
  secondary: 0.3,
  tertiary: 0.11,
};
const UPDATE_INTERVAL_MS = 90;
const VOICE_RELEASE_SECONDS = 0.7;

let enabled = true;
let context: AudioContext | null = null;
let masterGain: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let lifecycle: FindAudioLifecycle = 'idle';
let lifecycleGeneration = 0;
let shouldRun = false;
let stereoPanningAvailable: boolean | null = null;
let lastUpdateAt = 0;
let latestScene: FindAudioScene | null = null;
const voices = new Map<string, SignalVoice>();

function audioConstructor() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext ?? (window as AudioWindow).webkitAudioContext ?? null;
}

function makeNoiseBuffer(audioContext: AudioContext) {
  const length = Math.max(1, Math.floor(audioContext.sampleRate * 2.4));
  const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
  const channel = buffer.getChannelData(0);
  let previous = 0;
  for (let index = 0; index < length; index += 1) {
    const white = Math.random() * 2 - 1;
    previous = previous * 0.965 + white * 0.035;
    channel[index] = previous * 0.7;
  }
  return buffer;
}

function createVoice(id: string) {
  if (!context || !masterGain || !noiseBuffer) return null;
  const source = context.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;

  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 430;
  filter.Q.value = 0.62;

  const gain = context.createGain();
  gain.gain.value = 0;

  const pan = stereoPanningAvailable ? context.createStereoPanner() : null;
  if (pan) {
    pan.pan.value = 0;
    source.connect(filter).connect(pan).connect(gain).connect(masterGain);
  } else {
    source.connect(filter).connect(gain).connect(masterGain);
  }
  source.start();
  const voice = { source, filter, pan, gain, releaseToken: 0 };
  voices.set(id, voice);
  return voice;
}

function distanceIntensity(distanceMeters: number, isUnlocked: boolean) {
  if (isUnlocked) return 1;
  const proximity = Math.max(0, Math.min(1, (110 - distanceMeters) / 100));
  return 0.08 + Math.pow(proximity, 1.65) * 0.92;
}

function confidenceDirection(confidence: SensorConfidence) {
  if (confidence === 'high') return 1;
  if (confidence === 'medium') return 0.55;
  if (confidence === 'low') return 0.16;
  return 0;
}

function diagnostics(scene = latestScene): FindAudioDiagnostics {
  const primary = scene?.signals[0] ?? null;
  const directionStrength = confidenceDirection(scene?.confidence ?? 'unavailable');
  const pan = primary
    ? Math.sin(primary.angularDifference * Math.PI / 180)
      * directionStrength
      * (stereoPanningAvailable === false ? 0 : 1)
    : 0;
  return {
    enabled,
    capability: !audioConstructor()
      ? 'unavailable'
      : stereoPanningAvailable === false
        ? 'web-audio-centered'
        : 'web-audio',
    lifecycle: enabled ? lifecycle : 'disabled',
    angularDifference: primary?.angularDifference ?? null,
    pan,
    distanceMeters: primary?.distanceMeters ?? null,
    intensity: primary ? distanceIntensity(primary.distanceMeters, primary.isUnlocked) : 0,
    confidence: scene?.confidence ?? 'unavailable',
    activeVoices: voices.size,
  };
}

function silenceVoices(releaseSeconds = VOICE_RELEASE_SECONDS) {
  if (!context) return;
  const now = context.currentTime;
  for (const voice of voices.values()) {
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0, now, Math.max(0.04, releaseSeconds / 4));
  }
}

export function getFindAudioDiagnostics() {
  return diagnostics();
}

export function setFindAudioEnabled(nextEnabled: boolean) {
  enabled = nextEnabled;
  if (!enabled) {
    shouldRun = false;
    lifecycleGeneration += 1;
    lifecycle = 'disabled';
    silenceVoices(0.2);
    void suspendFindAudio();
  } else if (lifecycle === 'disabled') {
    lifecycle = context ? 'suspended' : 'idle';
  }
  return diagnostics();
}

export async function initializeFindAudio() {
  if (!enabled) return diagnostics();
  shouldRun = true;
  const generation = lifecycleGeneration + 1;
  lifecycleGeneration = generation;
  if (context?.state === 'running') {
    lifecycle = 'running';
    return diagnostics();
  }
  if (!context) {
    const AudioContextConstructor = audioConstructor();
    if (!AudioContextConstructor) {
      lifecycle = 'unavailable';
      return diagnostics();
    }
    lifecycle = 'starting';
    try {
      context = new AudioContextConstructor({ latencyHint: 'playback' });
      stereoPanningAvailable = typeof context.createStereoPanner === 'function';
      masterGain = context.createGain();
      masterGain.gain.value = 0;
      masterGain.connect(context.destination);
      noiseBuffer = makeNoiseBuffer(context);
    } catch {
      context = null;
      masterGain = null;
      noiseBuffer = null;
      lifecycle = 'unavailable';
      return diagnostics();
    }
  }

  try {
    await context.resume();
    if (generation !== lifecycleGeneration || !shouldRun) {
      if (!shouldRun) await context.suspend().catch(() => undefined);
      return diagnostics();
    }
    lifecycle = context.state === 'running' ? 'running' : 'suspended';
    if (masterGain && context.state === 'running') {
      masterGain.gain.cancelScheduledValues(context.currentTime);
      masterGain.gain.setTargetAtTime(0.42, context.currentTime, 0.16);
    }
  } catch {
    lifecycle = 'suspended';
  }
  return diagnostics();
}

export function updateFindAudioScene(scene: FindAudioScene) {
  latestScene = scene;
  if (!enabled) return diagnostics(scene);
  if (scene.simulateUnavailable) {
    shouldRun = false;
    lifecycleGeneration += 1;
    lifecycle = 'unavailable';
    silenceVoices(0.12);
    void context?.suspend().catch(() => undefined);
    return diagnostics(scene);
  }
  if (!scene.active || scene.signals.length === 0) {
    silenceVoices(scene.reducedMotion ? 1 : 0.55);
    return diagnostics(scene);
  }

  const nowMs = performance.now();
  if (nowMs - lastUpdateAt < UPDATE_INTERVAL_MS) return diagnostics(scene);
  lastUpdateAt = nowMs;
  if (context?.state === 'suspended') void initializeFindAudio();
  if (!context || !masterGain || context.state !== 'running') return diagnostics(scene);
  lifecycle = 'running';

  const now = context.currentTime;
  const smoothing = scene.reducedMotion ? 0.72 : 0.34;
  const activeIds = new Set(scene.signals.map((signal) => signal.id));

  for (const [id, voice] of voices) {
    if (activeIds.has(id)) continue;
    const releaseToken = voice.releaseToken + 1;
    voice.releaseToken = releaseToken;
    voice.gain.gain.setTargetAtTime(0, now, 0.12);
    window.setTimeout(() => {
      if (voice.releaseToken !== releaseToken || latestScene?.signals.some((signal) => signal.id === id)) return;
      try {
        voice.source.stop();
      } catch {
        // A voice may have been stopped while FIND was disposing.
      }
      voice.source.disconnect();
      voices.delete(id);
    }, 900);
  }

  for (const signal of scene.signals) {
    const voice = voices.get(signal.id) ?? createVoice(signal.id);
    if (!voice) continue;
    voice.releaseToken += 1;
    const intensity = distanceIntensity(signal.distanceMeters, signal.isUnlocked);
    const behindness = Math.abs(signal.angularDifference) / 180;
    const pan = Math.sin(signal.angularDifference * Math.PI / 180)
      * confidenceDirection(scene.confidence);
    const targetGain = (0.003 + intensity * 0.031)
      * PROMINENCE_GAIN[signal.prominence]
      * (1 - behindness * 0.24);
    const targetFrequency = 330 + intensity * 380 - behindness * 95;

    voice.gain.gain.setTargetAtTime(targetGain, now, smoothing);
    voice.pan?.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), now, smoothing);
    voice.filter.frequency.setTargetAtTime(targetFrequency, now, smoothing * 1.25);
  }

  return diagnostics(scene);
}

export async function suspendFindAudio() {
  shouldRun = false;
  const generation = lifecycleGeneration + 1;
  lifecycleGeneration = generation;
  if (!context || context.state === 'closed') {
    if (enabled && lifecycle !== 'unavailable') lifecycle = 'idle';
    return diagnostics();
  }
  silenceVoices(0.18);
  await new Promise((resolve) => window.setTimeout(resolve, 130));
  if (generation !== lifecycleGeneration || shouldRun || !context) return diagnostics();
  await context.suspend().catch(() => undefined);
  if (generation === lifecycleGeneration && !shouldRun && enabled) lifecycle = 'suspended';
  return diagnostics();
}

export async function disposeFindAudio() {
  shouldRun = false;
  lifecycleGeneration += 1;
  for (const voice of voices.values()) {
    try {
      voice.source.stop();
    } catch {
      // A source may already have stopped during release.
    }
    voice.source.disconnect();
  }
  voices.clear();
  const closingContext = context;
  context = null;
  masterGain = null;
  noiseBuffer = null;
  stereoPanningAvailable = null;
  latestScene = null;
  lastUpdateAt = 0;
  lifecycle = enabled ? 'idle' : 'disabled';
  await closingContext?.close().catch(() => undefined);
}

export function playFindSound(cue: FindSoundCue) {
  if (!enabled || !context || !masterGain || context.state !== 'running') return;
  const primary = latestScene?.signals[0] ?? null;
  const cueGain = context.createGain();
  const cueFilter = context.createBiquadFilter();
  const cuePan = stereoPanningAvailable ? context.createStereoPanner() : null;
  const cueSource = context.createBufferSource();
  if (!noiseBuffer) return;

  const now = context.currentTime;
  const duration = cue === 'unlock' ? 1.55 : cue === 'approaching' ? 0.72 : 0.5;
  const peak = cue === 'unlock' ? 0.038 : cue === 'approaching' ? 0.012 : 0.007;
  const pan = primary
    ? Math.sin(primary.angularDifference * Math.PI / 180)
      * confidenceDirection(latestScene?.confidence ?? 'unavailable')
    : 0;

  cueSource.buffer = noiseBuffer;
  cueSource.loop = false;
  cueFilter.type = 'bandpass';
  cueFilter.frequency.value = cue === 'unlock' ? 720 : cue === 'approaching' ? 520 : 390;
  cueFilter.Q.value = cue === 'unlock' ? 0.48 : 0.7;
  if (cuePan) cuePan.pan.value = pan;
  cueGain.gain.setValueAtTime(0.0001, now);
  cueGain.gain.exponentialRampToValueAtTime(peak, now + duration * 0.28);
  cueGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  if (cuePan) cueSource.connect(cueFilter).connect(cuePan).connect(cueGain).connect(masterGain);
  else cueSource.connect(cueFilter).connect(cueGain).connect(masterGain);
  cueSource.start(now, Math.random() * Math.max(0.1, noiseBuffer.duration - duration), duration);
  cueSource.stop(now + duration);
  cueSource.addEventListener('ended', () => cueSource.disconnect(), { once: true });
}