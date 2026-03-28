import type { AIEditingSettings } from './types';

const LEGACY_DEFAULT_SILENCE_PADDING_SECONDS = [0.12, 0.15] as const;
const LEGACY_DEFAULT_SILENCE_MIN_DURATION_SECONDS = 0.08;
const FLOAT_EPSILON = 1e-3;

function isApproximately(value: number | undefined, target: number) {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value - target) <= FLOAT_EPSILON;
}

function normalizeLegacySilenceRemovalPatch(
  patch?: Partial<AIEditingSettings>,
): Partial<AIEditingSettings> | undefined {
  if (!patch?.silenceRemoval) return patch;

  const silenceRemoval = patch.silenceRemoval;
  const paddingLooksLegacy = LEGACY_DEFAULT_SILENCE_PADDING_SECONDS.some((value) => (
    isApproximately(silenceRemoval.paddingSeconds, value)
  ));
  if (!paddingLooksLegacy) return patch;

  const minDurationLooksDefault = silenceRemoval.minDurationSeconds === undefined
    || isApproximately(silenceRemoval.minDurationSeconds, LEGACY_DEFAULT_SILENCE_MIN_DURATION_SECONDS);
  const preserveShortPausesLooksDefault = silenceRemoval.preserveShortPauses === undefined
    || silenceRemoval.preserveShortPauses === false;
  const requireSpeakerAbsenceLooksDefault = silenceRemoval.requireSpeakerAbsence === undefined
    || silenceRemoval.requireSpeakerAbsence === true;

  if (!minDurationLooksDefault || !preserveShortPausesLooksDefault || !requireSpeakerAbsenceLooksDefault) {
    return patch;
  }

  return {
    ...patch,
    silenceRemoval: {
      ...silenceRemoval,
      paddingSeconds: 0,
    },
  };
}

export const DEFAULT_AI_EDITING_SETTINGS: AIEditingSettings = {
  silenceRemoval: {
    paddingSeconds: 0,
    minDurationSeconds: 0.08,
    preserveShortPauses: false,
    requireSpeakerAbsence: true,
  },
  frameInspection: {
    defaultFrameCount: 30,
    overviewIntervalSeconds: 5,
    maxOverviewFrames: 720,
  },
  captions: {
    wordsPerCaption: 4,
  },
  transitions: {
    defaultDuration: 1,
    defaultType: 'fade_black',
  },
  textOverlays: {
    defaultPosition: 'bottom',
    defaultFontSize: 16,
  },
};

export function mergeAISettings(
  current: AIEditingSettings,
  patch?: Partial<AIEditingSettings>,
): AIEditingSettings {
  const normalizedPatch = normalizeLegacySilenceRemovalPatch(patch);
  if (!normalizedPatch) return current;

  const normalizedTransitionPatch = normalizedPatch.transitions
    ? {
        ...normalizedPatch.transitions,
        ...(normalizedPatch.transitions.defaultType ? { defaultType: 'fade_black' as const } : {}),
      }
    : undefined;

  return {
    silenceRemoval: { ...current.silenceRemoval, ...normalizedPatch.silenceRemoval },
    frameInspection: { ...current.frameInspection, ...normalizedPatch.frameInspection },
    captions: { ...current.captions, ...normalizedPatch.captions },
    transitions: { ...current.transitions, ...normalizedTransitionPatch },
    textOverlays: { ...current.textOverlays, ...normalizedPatch.textOverlays },
  };
}

export function resolveAIEditingSettings(patch?: Partial<AIEditingSettings>): AIEditingSettings {
  return mergeAISettings(DEFAULT_AI_EDITING_SETTINGS, patch);
}
