import type { MusicCue } from './types';

const DEFAULT_MUSIC_CUE_EXTENSION = 'mp3';

export function getMusicCueFileExtension(cue: Pick<MusicCue, 'storagePath'>): string {
  const extension = cue.storagePath?.split('.').pop()?.trim().toLowerCase();
  return extension && /^[a-z0-9]+$/.test(extension) ? extension : DEFAULT_MUSIC_CUE_EXTENSION;
}

export function getMusicCueFileName(cue: Pick<MusicCue, 'id' | 'mood' | 'storagePath'>): string {
  return `music_${cue.mood}_${cue.id}.${getMusicCueFileExtension(cue)}`;
}
