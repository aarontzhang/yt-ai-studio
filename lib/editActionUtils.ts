import { v4 as uuidv4 } from 'uuid';
import { buildClipSchedule, normalizeTransitionEntries } from './playbackEngine';
import { normalizeTextOverlayEntry } from './textOverlays';
import { buildCaptionEntriesFromWords, projectCaptionWordsToTimeline } from './timelineUtils';
import type {
  AppliedActionRecord,
  CaptionEntry,
  EditAction,
  MarkerEntry,
  TextOverlayEntry,
  TransitionEntry,
  VideoClip,
} from './types';

export interface EditSnapshot {
  clips: VideoClip[];
  captions: CaptionEntry[];
  transitions: TransitionEntry[];
  markers: MarkerEntry[];
  textOverlays: TextOverlayEntry[];
  appliedActions?: AppliedActionRecord[];
}

export interface ReviewOverlayDescriptor {
  id: string;
  itemId: string;
  kind: 'cut' | 'caption' | 'transition' | 'marker' | 'text';
  startTime?: number;
  endTime?: number;
  atTime?: number;
  label?: string;
}

export interface EditReviewItem {
  id: string;
  index: number;
  action: EditAction;
  checked: boolean;
  label: string;
  summary: string;
  anchorTime: number | null;
  overlay: ReviewOverlayDescriptor | null;
}

export interface EditReviewGroup {
  ownerId: string;
  originalAction: EditAction;
  baseSnapshot: EditSnapshot;
  sourceTranscriptCaptions?: CaptionEntry[] | null;
  items: EditReviewItem[];
}

export const MIN_CLIP_DURATION_SECONDS = 0.05;
export const CLIP_EDGE_SNAP_EPSILON_SECONDS = 0.08;

export function sanitizeTimelineClips(clips: VideoClip[]): VideoClip[] {
  return clips.filter((clip) => (
    Number.isFinite(clip.sourceDuration)
    && Number.isFinite(clip.speed)
    && clip.speed > 0
    && clip.sourceDuration >= MIN_CLIP_DURATION_SECONDS
  ));
}

function snapTimeToClipEdge(time: number, timelineStart: number, timelineEnd: number) {
  if (Math.abs(time - timelineStart) <= CLIP_EDGE_SNAP_EPSILON_SECONDS) {
    return timelineStart;
  }
  if (Math.abs(time - timelineEnd) <= CLIP_EDGE_SNAP_EPSILON_SECONDS) {
    return timelineEnd;
  }
  return time;
}

function mergeDeleteRanges(ranges: Array<{ start: number; end: number }>) {
  if (ranges.length === 0) return [];

  const sorted = [...ranges]
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (sorted.length === 0) return [];

  const merged = [{ ...sorted[0] }];
  for (const range of sorted.slice(1)) {
    const current = merged[merged.length - 1];
    if (range.start <= current.end + CLIP_EDGE_SNAP_EPSILON_SECONDS) {
      current.end = Math.max(current.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function withCaptionStyle(caption: CaptionEntry, action: EditAction): CaptionEntry {
  return {
    ...caption,
    renderStyle: caption.renderStyle ?? action.captionStyle ?? (caption.words?.length ? 'rolling_word' : 'static'),
  };
}

function buildResolvedCaptionAction(
  snapshot: EditSnapshot,
  action: EditAction,
  sourceTranscriptCaptions?: CaptionEntry[] | null,
): EditAction {
  if (action.type !== 'add_captions') return action;

  if (Array.isArray(action.captions) && action.captions.length > 0) {
    return {
      ...action,
      captions: action.captions.map((caption) => withCaptionStyle(caption, action)),
    };
  }

  if (!action.transcriptRange || !sourceTranscriptCaptions || sourceTranscriptCaptions.length === 0) {
    return action;
  }

  const remappedWords = projectCaptionWordsToTimeline(
    snapshot.clips,
    sourceTranscriptCaptions,
    snapshot.transitions,
  ).filter((word) => (
    word.endTime > action.transcriptRange!.startTime
    && word.startTime < action.transcriptRange!.endTime
  ));

  if (remappedWords.length === 0) {
    return action;
  }

  return {
    ...action,
    captions: buildCaptionEntriesFromWords(remappedWords).map((caption) => withCaptionStyle(caption, action)),
  };
}

function remapWordAfterDelete(
  word: NonNullable<CaptionEntry['words']>[number],
  startTime: number,
  endTime: number,
) {
  if (word.endTime <= startTime) return { ...word };

  const delta = endTime - startTime;
  if (word.startTime >= endTime) {
    return {
      ...word,
      startTime: word.startTime - delta,
      endTime: word.endTime - delta,
    };
  }

  const nextStart = word.startTime < startTime ? word.startTime : null;
  const nextEnd = word.endTime > endTime
    ? word.endTime - delta
    : word.endTime <= startTime
      ? word.endTime
      : null;
  if (nextStart === null || nextEnd === null || nextEnd <= nextStart) {
    return null;
  }

  return {
    ...word,
    startTime: nextStart,
    endTime: nextEnd,
  };
}

function remapCaptionAfterDelete(
  caption: CaptionEntry,
  startTime: number,
  endTime: number,
): CaptionEntry | null {
  if (caption.words && caption.words.length > 0) {
    const nextWords = caption.words
      .map((word) => remapWordAfterDelete(word, startTime, endTime))
      .filter((word): word is NonNullable<CaptionEntry['words']>[number] => !!word);
    if (nextWords.length === 0) return null;
    return {
      ...caption,
      startTime: nextWords[0].startTime,
      endTime: nextWords[nextWords.length - 1].endTime,
      text: nextWords.map((word) => word.text).join(' '),
      words: nextWords,
    };
  }

  if (caption.endTime <= startTime) return caption;

  const delta = endTime - startTime;
  if (caption.startTime >= endTime) {
    return {
      ...caption,
      startTime: caption.startTime - delta,
      endTime: caption.endTime - delta,
    };
  }

  const nextStart = caption.startTime < startTime ? caption.startTime : startTime;
  const nextEnd = caption.endTime > endTime
    ? caption.endTime - delta
    : Math.min(caption.endTime, startTime);
  if (nextEnd <= nextStart) return null;

  return {
    ...caption,
    startTime: nextStart,
    endTime: nextEnd,
  };
}

function remapCaptionsAfterDelete(
  captions: CaptionEntry[],
  startTime: number,
  endTime: number,
): CaptionEntry[] {
  return captions
    .map((caption) => remapCaptionAfterDelete(caption, startTime, endTime))
    .filter((caption): caption is CaptionEntry => !!caption);
}

export function splitClipsAtTime(clips: VideoClip[], timelineTime: number): VideoClip[] {
  const normalizedClips = sanitizeTimelineClips(clips);
  const schedule = buildClipSchedule(normalizedClips);
  const targetEntry = schedule.find((entry) => {
    const snappedTime = snapTimeToClipEdge(timelineTime, entry.timelineStart, entry.timelineEnd);
    return snappedTime > entry.timelineStart && snappedTime < entry.timelineEnd;
  });
  if (!targetEntry) return normalizedClips;

  const clip = normalizedClips.find(item => item.id === targetEntry.clipId);
  if (!clip) return normalizedClips;

  const snappedTime = snapTimeToClipEdge(timelineTime, targetEntry.timelineStart, targetEntry.timelineEnd);
  const offsetInTimeline = snappedTime - targetEntry.timelineStart;
  const splitSourceOffset = offsetInTimeline * targetEntry.speed;
  const firstDuration = splitSourceOffset;
  const secondStart = clip.sourceStart + splitSourceOffset;
  const secondDuration = clip.sourceDuration - splitSourceOffset;
  if (firstDuration < MIN_CLIP_DURATION_SECONDS || secondDuration < MIN_CLIP_DURATION_SECONDS) return normalizedClips;

  const firstClip: VideoClip = { ...clip, sourceDuration: firstDuration };
  const secondClip: VideoClip = { ...clip, id: uuidv4(), sourceStart: secondStart, sourceDuration: secondDuration };
  const index = normalizedClips.findIndex(item => item.id === clip.id);
  return [...normalizedClips.slice(0, index), firstClip, secondClip, ...normalizedClips.slice(index + 1)];
}

export function deleteRangeFromClips(clips: VideoClip[], startTime: number, endTime: number): VideoClip[] {
  const normalizedClips = sanitizeTimelineClips(clips);
  if (endTime <= startTime) return normalizedClips;
  const schedule = buildClipSchedule(normalizedClips);
  const nextClips: VideoClip[] = [];

  for (const entry of schedule) {
    const clip = normalizedClips.find(item => item.id === entry.clipId);
    if (!clip) continue;
    const timelineStart = entry.timelineStart;
    const timelineEnd = entry.timelineEnd;
    const speed = entry.speed;
    const effectiveStart = snapTimeToClipEdge(startTime, timelineStart, timelineEnd);
    const effectiveEnd = snapTimeToClipEdge(endTime, timelineStart, timelineEnd);

    if (timelineEnd <= effectiveStart || timelineStart >= effectiveEnd) {
      nextClips.push(clip);
      continue;
    }

    if (timelineStart >= effectiveStart && timelineEnd <= effectiveEnd) {
      continue;
    }

    if (timelineStart < effectiveStart && timelineEnd > effectiveEnd) {
      const firstDuration = (effectiveStart - timelineStart) * speed;
      const secondOffset = (effectiveEnd - timelineStart) * speed;
      const secondDuration = clip.sourceDuration - secondOffset;
      if (firstDuration >= MIN_CLIP_DURATION_SECONDS) nextClips.push({ ...clip, sourceDuration: firstDuration });
      if (secondDuration >= MIN_CLIP_DURATION_SECONDS) {
        nextClips.push({
          ...clip,
          id: uuidv4(),
          sourceStart: clip.sourceStart + secondOffset,
          sourceDuration: secondDuration,
        });
      }
      continue;
    }

    if (timelineStart < effectiveStart) {
      const keptDuration = (effectiveStart - timelineStart) * speed;
      if (keptDuration >= MIN_CLIP_DURATION_SECONDS) nextClips.push({ ...clip, sourceDuration: keptDuration });
      continue;
    }

    const cutOffset = (effectiveEnd - timelineStart) * speed;
    const remainingDuration = clip.sourceDuration - cutOffset;
    if (remainingDuration >= MIN_CLIP_DURATION_SECONDS) {
      nextClips.push({
        ...clip,
        sourceStart: clip.sourceStart + cutOffset,
        sourceDuration: remainingDuration,
      });
    }
  }

  return sanitizeTimelineClips(nextClips);
}

export function actionChangesTimelineStructure(action: EditAction) {
  return ['split_clip', 'delete_range', 'delete_ranges', 'delete_clip', 'reorder_clip', 'set_clip_speed', 'add_transition'].includes(action.type);
}

function withClearedMarkers(snapshot: EditSnapshot, patch: Partial<EditSnapshot>): EditSnapshot {
  return {
    ...snapshot,
    ...patch,
    markers: [],
  };
}

function withTimelineChanges(snapshot: EditSnapshot, patch: Partial<EditSnapshot>): EditSnapshot {
  const nextClips = patch.clips ?? snapshot.clips;
  const nextTransitions = normalizeTransitionEntries(nextClips, patch.transitions ?? snapshot.transitions);
  return withClearedMarkers(snapshot, {
    ...patch,
    clips: nextClips,
    transitions: nextTransitions,
  });
}

export function applyActionToSnapshot(
  snapshot: EditSnapshot,
  action: EditAction,
  options?: {
    sourceTranscriptCaptions?: CaptionEntry[] | null;
  },
): EditSnapshot {
  const resolvedAction = buildResolvedCaptionAction(snapshot, action, options?.sourceTranscriptCaptions);
  if (
    resolvedAction.type === 'none' ||
    resolvedAction.type === 'transcribe_request' ||
    resolvedAction.type === 'request_frames' ||
    resolvedAction.type === 'update_ai_settings'
  ) return snapshot;

  if (resolvedAction.type === 'split_clip') {
    if (resolvedAction.splitTime === undefined) return snapshot;
    const clips = splitClipsAtTime(snapshot.clips, resolvedAction.splitTime);
    return clips === snapshot.clips ? snapshot : withTimelineChanges(snapshot, { clips });
  }

  if (resolvedAction.type === 'delete_range') {
    if (resolvedAction.deleteStartTime === undefined || resolvedAction.deleteEndTime === undefined) return snapshot;
    return withTimelineChanges(snapshot, {
      clips: deleteRangeFromClips(snapshot.clips, resolvedAction.deleteStartTime, resolvedAction.deleteEndTime),
      captions: remapCaptionsAfterDelete(snapshot.captions, resolvedAction.deleteStartTime, resolvedAction.deleteEndTime),
    });
  }

  if (resolvedAction.type === 'delete_ranges') {
    const ranges = mergeDeleteRanges(resolvedAction.ranges ?? []).sort((a, b) => b.start - a.start);
    const clips = ranges.reduce((acc, range) => {
      if (range.end <= range.start) return acc;
      return deleteRangeFromClips(acc, range.start, range.end);
    }, snapshot.clips);
    const captions = ranges.reduce((acc, range) => (
      range.end <= range.start ? acc : remapCaptionsAfterDelete(acc, range.start, range.end)
    ), snapshot.captions);
    return withTimelineChanges(snapshot, { clips, captions });
  }

  if (resolvedAction.type === 'reorder_clip') {
    const clipIndex = resolvedAction.clipIndex ?? 0;
    const clip = snapshot.clips[clipIndex];
    if (!clip || resolvedAction.newIndex === undefined) return snapshot;
    const remaining = snapshot.clips.filter(item => item.id !== clip.id);
    const targetIndex = Math.max(0, Math.min(resolvedAction.newIndex, remaining.length));
    const clips = [...remaining.slice(0, targetIndex), clip, ...remaining.slice(targetIndex)];
    return withTimelineChanges(snapshot, { clips });
  }

  if (resolvedAction.type === 'delete_clip') {
    const clipIndex = resolvedAction.clipIndex ?? 0;
    const clip = snapshot.clips[clipIndex];
    if (!clip) return snapshot;
    return withTimelineChanges(snapshot, {
      clips: snapshot.clips.filter(item => item.id !== clip.id),
    });
  }

  if (resolvedAction.type === 'set_clip_speed') {
    const clip = snapshot.clips[resolvedAction.clipIndex ?? 0];
    if (!clip || resolvedAction.speed === undefined) return snapshot;
    return withTimelineChanges(snapshot, {
      clips: snapshot.clips.map(item => item.id === clip.id ? { ...item, speed: resolvedAction.speed ?? item.speed } : item),
    });
  }

  if (resolvedAction.type === 'set_clip_volume') {
    const clip = snapshot.clips[resolvedAction.clipIndex ?? 0];
    if (!clip || resolvedAction.volume === undefined) return snapshot;
    return {
      ...snapshot,
      clips: snapshot.clips.map(item => item.id === clip.id ? {
        ...item,
        volume: resolvedAction.volume ?? item.volume,
        ...(resolvedAction.fadeIn !== undefined ? { fadeIn: resolvedAction.fadeIn } : {}),
        ...(resolvedAction.fadeOut !== undefined ? { fadeOut: resolvedAction.fadeOut } : {}),
      } : item),
    };
  }

  if (resolvedAction.type === 'set_clip_filter') {
    const clip = snapshot.clips[resolvedAction.clipIndex ?? 0];
    if (!clip) return snapshot;
    return {
      ...snapshot,
      clips: snapshot.clips.map(item => item.id === clip.id ? { ...item, filter: resolvedAction.filter ?? null } : item),
    };
  }

  if (resolvedAction.type === 'add_captions') {
    if (!resolvedAction.captions?.length) return snapshot;
    return {
      ...snapshot,
      captions: [...snapshot.captions, ...(resolvedAction.captions ?? []).map(caption => ({ ...caption, id: uuidv4() }))],
    };
  }

  if (resolvedAction.type === 'add_transition') {
    const transitions = normalizeTransitionEntries(
      snapshot.clips,
      [...snapshot.transitions, ...(resolvedAction.transitions ?? []).map((transition) => ({ ...transition, id: uuidv4() }))],
    );
    return {
      ...snapshot,
      transitions,
    };
  }

  if (resolvedAction.type === 'add_marker') {
    const marker = resolvedAction.marker;
    if (marker?.timelineTime === undefined) return snapshot;
    const nextNumber = snapshot.markers.length === 0
      ? 1
      : Math.max(...snapshot.markers.map((entry) => entry.number)) + 1;
    return {
      ...snapshot,
      markers: [
        ...snapshot.markers,
        {
          id: marker.id ?? uuidv4(),
          number: marker.number ?? nextNumber,
          timelineTime: marker.timelineTime,
          label: marker.label,
          createdBy: marker.createdBy ?? 'ai',
          status: marker.status ?? 'open',
          linkedRange: marker.linkedRange,
          linkedMessageId: marker.linkedMessageId,
          confidence: marker.confidence ?? null,
          note: marker.note,
        },
      ],
    };
  }

  if (resolvedAction.type === 'add_markers') {
    const markers = (resolvedAction.markers ?? []).filter((marker) => marker.timelineTime !== undefined);
    if (markers.length === 0) return snapshot;
    let nextNumber = snapshot.markers.length === 0
      ? 1
      : Math.max(...snapshot.markers.map((entry) => entry.number)) + 1;
    return {
      ...snapshot,
      markers: [
        ...snapshot.markers,
        ...markers.map((marker) => ({
          id: marker.id ?? uuidv4(),
          number: marker.number ?? nextNumber++,
          timelineTime: marker.timelineTime!,
          label: marker.label,
          createdBy: marker.createdBy ?? 'ai',
          status: marker.status ?? 'open',
          linkedRange: marker.linkedRange,
          linkedMessageId: marker.linkedMessageId,
          confidence: marker.confidence ?? null,
          note: marker.note,
        })),
      ],
    };
  }

  if (resolvedAction.type === 'update_marker') {
    if (!resolvedAction.markerId) return snapshot;
    return {
      ...snapshot,
      markers: snapshot.markers.map((marker) => (
        marker.id === resolvedAction.markerId
          ? {
              ...marker,
              ...resolvedAction.marker,
              timelineTime: resolvedAction.marker?.timelineTime ?? marker.timelineTime,
              number: resolvedAction.marker?.number ?? marker.number,
            }
          : marker
      )),
    };
  }

  if (resolvedAction.type === 'remove_marker') {
    if (!resolvedAction.markerId) return snapshot;
    return {
      ...snapshot,
      markers: snapshot.markers.filter((marker) => marker.id !== resolvedAction.markerId),
    };
  }

  if (resolvedAction.type === 'add_text_overlay') {
    return {
      ...snapshot,
      textOverlays: [
        ...snapshot.textOverlays,
        ...(resolvedAction.textOverlays ?? [])
          .map((overlay) => normalizeTextOverlayEntry(overlay))
          .filter((overlay): overlay is TextOverlayEntry => !!overlay)
          .map((overlay) => ({ ...overlay, id: uuidv4() })),
      ],
    };
  }

  if (resolvedAction.type === 'replace_text_overlay') {
    const replacementSource = resolvedAction.textOverlays?.[0];
    const replacement = replacementSource ? normalizeTextOverlayEntry(replacementSource) : null;
    const overlayIndex = resolvedAction.overlayIndex ?? 0;
    if (!replacement || overlayIndex >= snapshot.textOverlays.length) return snapshot;
    const textOverlays = [...snapshot.textOverlays];
    textOverlays[overlayIndex] = { ...replacement, id: uuidv4() };
    return { ...snapshot, textOverlays };
  }

  return snapshot;
}

export function expandActionForReview(action: EditAction): EditAction[] {
  if (action.type === 'delete_ranges') {
    return [...(action.ranges ?? [])]
      .sort((a, b) => a.start - b.start)
      .map(range => ({
        type: 'delete_range' as const,
        deleteStartTime: range.start,
        deleteEndTime: range.end,
        message: `Remove ${range.start.toFixed(2)}s to ${range.end.toFixed(2)}s.`,
      }));
  }

  if (action.type === 'add_captions') {
    if (action.captions?.length) {
      return action.captions.map(caption => ({
        type: 'add_captions' as const,
        captions: [caption],
        message: action.message,
      }));
    }
    return [action];
  }

  if (action.type === 'add_transition') {
    return (action.transitions ?? []).map(transition => ({
      type: 'add_transition' as const,
      transitions: [transition],
      message: action.message,
    }));
  }

  if (action.type === 'add_markers') {
    return (action.markers ?? []).map((marker) => ({
      type: 'add_marker' as const,
      marker,
      message: action.message,
    }));
  }

  if (action.type === 'add_text_overlay') {
    return (action.textOverlays ?? []).map(textOverlay => ({
      type: 'add_text_overlay' as const,
      textOverlays: [textOverlay],
      message: action.message,
    }));
  }

  return [action];
}

function getReviewItemAnchorTime(action: EditAction): number | null {
  if (action.type === 'split_clip') return action.splitTime ?? null;
  if (action.type === 'delete_range') return action.deleteStartTime ?? null;
  if (action.type === 'add_captions') {
    return action.captions?.[0]?.startTime ?? action.transcriptRange?.startTime ?? null;
  }
  if (action.type === 'add_transition') return action.transitions?.[0]?.atTime ?? null;
  if (action.type === 'add_marker') return action.marker?.timelineTime ?? null;
  if (action.type === 'add_text_overlay') return action.textOverlays?.[0]?.startTime ?? null;
  return null;
}

function getReviewItemDescriptor(itemId: string, action: EditAction): ReviewOverlayDescriptor | null {
  if (action.type === 'delete_range') {
    return {
      id: `${itemId}:cut`,
      itemId,
      kind: 'cut',
      startTime: action.deleteStartTime,
      endTime: action.deleteEndTime,
      label: 'Cut',
    };
  }

  if (action.type === 'add_captions') {
    const caption = action.captions?.[0];
    if (!caption && !action.transcriptRange) return null;
    return {
      id: `${itemId}:caption`,
      itemId,
      kind: 'caption',
      startTime: caption?.startTime ?? action.transcriptRange?.startTime,
      endTime: caption?.endTime ?? action.transcriptRange?.endTime,
      label: caption?.text ?? action.message,
    };
  }

  if (action.type === 'add_transition') {
    const transition = action.transitions?.[0];
    if (!transition) return null;
    return {
      id: `${itemId}:transition`,
      itemId,
      kind: 'transition',
      atTime: transition.atTime,
      label: transition.type,
    };
  }

  if (action.type === 'add_marker') {
    if (action.marker?.timelineTime === undefined) return null;
    return {
      id: `${itemId}:marker`,
      itemId,
      kind: 'marker',
      atTime: action.marker.timelineTime,
      label: action.marker.label,
    };
  }

  if (action.type === 'add_text_overlay') {
    const overlay = action.textOverlays?.[0];
    if (!overlay) return null;
    return {
      id: `${itemId}:text`,
      itemId,
      kind: 'text',
      startTime: overlay.startTime,
      endTime: overlay.endTime,
      label: overlay.text,
    };
  }

  return null;
}

function getReviewItemLabel(action: EditAction, index: number): { label: string; summary: string } {
  if (action.type === 'delete_range') {
    const start = action.deleteStartTime ?? 0;
    const end = action.deleteEndTime ?? 0;
    return {
      label: `Cut ${index + 1}`,
      summary: `${start.toFixed(3)}s - ${end.toFixed(3)}s`,
    };
  }

  if (action.type === 'add_captions') {
    const caption = action.captions?.[0];
    return {
      label: action.transcriptRange && !caption ? 'Captions' : `Caption ${index + 1}`,
      summary: caption
        ? caption.text
        : action.transcriptRange
          ? `${action.transcriptRange.startTime.toFixed(3)}s - ${action.transcriptRange.endTime.toFixed(3)}s`
          : 'Caption preview',
    };
  }

  if (action.type === 'add_transition') {
    const transition = action.transitions?.[0];
    return {
      label: `Transition ${index + 1}`,
      summary: transition ? `${transition.type} at ${transition.atTime.toFixed(3)}s` : 'Transition preview',
    };
  }

  if (action.type === 'add_marker') {
    return {
      label: `Marker ${index + 1}`,
      summary: action.marker?.timelineTime !== undefined ? `${action.marker.timelineTime.toFixed(3)}s` : 'Marker preview',
    };
  }

  if (action.type === 'add_text_overlay') {
    const overlay = action.textOverlays?.[0];
    return {
      label: `Text ${index + 1}`,
      summary: overlay?.text ?? 'Text overlay preview',
    };
  }

  return {
    label: action.message || `Edit ${index + 1}`,
    summary: '',
  };
}

export function createReviewGroup(
  ownerId: string,
  action: EditAction,
  baseSnapshot: EditSnapshot,
  options?: {
    sourceTranscriptCaptions?: CaptionEntry[] | null;
  },
): EditReviewGroup | null {
  const reviewActions = expandActionForReview(action);
  if (reviewActions.length === 0) return null;

  return {
    ownerId,
    originalAction: action,
    baseSnapshot,
    sourceTranscriptCaptions: options?.sourceTranscriptCaptions ?? null,
    items: reviewActions.map((reviewAction, index) => {
      const id = `${ownerId}:${reviewAction.type}:${index}`;
      const itemCopy = JSON.parse(JSON.stringify(reviewAction)) as EditAction;
      const descriptor = getReviewItemDescriptor(id, itemCopy);
      const label = getReviewItemLabel(itemCopy, index);
      return {
        id,
        index,
        action: itemCopy,
        checked: true,
        label: label.label,
        summary: label.summary,
        anchorTime: getReviewItemAnchorTime(itemCopy),
        overlay: descriptor,
      };
    }),
  };
}

export function getCheckedReviewItems(group: EditReviewGroup): EditReviewItem[] {
  return group.items.filter((item) => item.checked);
}

export function buildReviewPreviewSnapshot(group: EditReviewGroup): EditSnapshot {
  const collapsedAction = collapseReviewItemsToAction(group);
  if (!collapsedAction) return group.baseSnapshot;

  // Review items are defined against the base snapshot. Applying the collapsed
  // action once keeps batched delete ranges aligned with those original times.
  return applyActionToSnapshot(group.baseSnapshot, collapsedAction, {
    sourceTranscriptCaptions: group.sourceTranscriptCaptions,
  });
}

export function buildReviewGroupWithUpdatedItems(
  group: EditReviewGroup,
  updater: (items: EditReviewItem[]) => EditReviewItem[],
): EditReviewGroup {
  return {
    ...group,
    items: updater(group.items),
  };
}

export function collapseReviewItemsToAction(group: EditReviewGroup): EditAction | null {
  const checkedItems = getCheckedReviewItems(group);
  if (checkedItems.length === 0) return null;

  const { originalAction } = group;
  const message = originalAction.message;

  if (originalAction.type === 'delete_ranges' || originalAction.type === 'delete_range') {
    const ranges = checkedItems
      .filter((item) => item.action.type === 'delete_range')
      .map((item) => ({
        start: item.action.deleteStartTime ?? 0,
        end: item.action.deleteEndTime ?? 0,
      }));
    if (ranges.length === 0) return null;
    if (ranges.length === 1) {
      return {
        type: 'delete_range',
        deleteStartTime: ranges[0].start,
        deleteEndTime: ranges[0].end,
        message,
      };
    }
    return {
      type: 'delete_ranges',
      ranges,
      message,
    };
  }

  if (originalAction.type === 'add_captions') {
    const captions = checkedItems.flatMap((item) => item.action.captions ?? []);
    if (captions.length > 0) {
      return { type: 'add_captions', captions, message };
    }
    return checkedItems.length > 0 ? originalAction : null;
  }

  if (originalAction.type === 'add_transition') {
    const transitions = checkedItems.flatMap((item) => item.action.transitions ?? []);
    return transitions.length > 0 ? { type: 'add_transition', transitions, message } : null;
  }

  if (originalAction.type === 'add_markers' || originalAction.type === 'add_marker') {
    const markers = checkedItems.flatMap((item) => item.action.type === 'add_marker' && item.action.marker ? [item.action.marker] : []);
    if (markers.length === 0) return null;
    if (markers.length === 1) {
      return { type: 'add_marker', marker: markers[0], message };
    }
    return { type: 'add_markers', markers, message };
  }

  if (originalAction.type === 'add_text_overlay') {
    const textOverlays = checkedItems.flatMap((item) => item.action.textOverlays ?? []);
    return textOverlays.length > 0 ? { type: 'add_text_overlay', textOverlays, message } : null;
  }

  return checkedItems[0]?.action ?? null;
}

export function getReviewOverlayDescriptors(group: EditReviewGroup): ReviewOverlayDescriptor[] {
  return group.items
    .filter((item) => item.checked && item.overlay)
    .map((item) => item.overlay!)
    .filter(Boolean);
}
