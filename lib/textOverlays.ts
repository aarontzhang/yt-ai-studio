import type { TextOverlayEntry } from './types';

export const DEFAULT_TEXT_OVERLAY_FONT_SIZE = 16;
const TOP_OVERLAY_INSET_RATIO = 0.03;
const TOP_OVERLAY_INSET_MIN = 20;
const BOTTOM_OVERLAY_INSET_RATIO = 0.085;
const BOTTOM_OVERLAY_INSET_MIN = 60;

export function normalizeTextOverlayEntry(entry: Partial<TextOverlayEntry>): TextOverlayEntry | null {
  if (
    !Number.isFinite(entry.startTime)
    || !Number.isFinite(entry.endTime)
    || entry.endTime! <= entry.startTime!
    || typeof entry.text !== 'string'
  ) {
    return null;
  }

  return {
    id: typeof entry.id === 'string' ? entry.id : undefined,
    startTime: entry.startTime!,
    endTime: entry.endTime!,
    text: entry.text,
    position: entry.position === 'top' || entry.position === 'center' || entry.position === 'bottom'
      ? entry.position
      : 'bottom',
    fontSize: Number.isFinite(entry.fontSize) ? Math.max(10, Number(entry.fontSize)) : undefined,
  };
}

export function getTextOverlayFontSize(entry: Pick<TextOverlayEntry, 'fontSize'>) {
  return Number.isFinite(entry.fontSize) ? Math.max(10, Number(entry.fontSize)) : DEFAULT_TEXT_OVERLAY_FONT_SIZE;
}

export function getTextOverlayInset(position: TextOverlayEntry['position'], frameHeight: number) {
  if (position === 'top') {
    return Math.max(TOP_OVERLAY_INSET_MIN, Math.round(frameHeight * TOP_OVERLAY_INSET_RATIO));
  }
  if (position === 'bottom') {
    return Math.max(BOTTOM_OVERLAY_INSET_MIN, Math.round(frameHeight * BOTTOM_OVERLAY_INSET_RATIO));
  }
  return 0;
}

export function getTextOverlayPreviewPositionStyle(
  position: TextOverlayEntry['position'],
  frameHeight: number,
) {
  if (position === 'top') {
    return {
      top: getTextOverlayInset('top', frameHeight),
      transform: 'translateX(-50%)',
    };
  }
  if (position === 'bottom') {
    return {
      bottom: getTextOverlayInset('bottom', frameHeight),
      transform: 'translateX(-50%)',
    };
  }
  return {
    top: '50%',
    transform: 'translate(-50%, -50%)',
  };
}

export function getTextOverlayExportY(position: TextOverlayEntry['position'], frameHeight: number) {
  if (position === 'top') {
    return `${getTextOverlayInset('top', frameHeight)}`;
  }
  if (position === 'bottom') {
    return `${Math.max(0, frameHeight - getTextOverlayInset('bottom', frameHeight))}-text_h`;
  }
  return '(h-text_h)/2';
}
