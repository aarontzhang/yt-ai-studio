export type CaptionRenderStyle = 'rolling_word' | 'static';

export interface CaptionWordTiming {
  startTime: number;
  endTime: number;
  text: string;
}

export interface VideoClip {
  id: string;
  sourceId: string;
  sourceStart: number;   // seconds into original video
  sourceDuration: number; // duration in source
  // Per-clip effects
  speed: number;         // default 1.0
  volume: number;        // 0.0–2.0, default 1.0
  filter: ColorFilter | null;
  fadeIn: number;        // seconds
  fadeOut: number;       // seconds
}

export interface ClipScheduleEntry {
  clipId: string;
  sourceId: string;
  timelineStart: number;  // position in output timeline
  timelineEnd: number;
  sourceStart: number;
  sourceDuration: number;
  speed: number;
}

export interface CaptionEntry {
  id?: string;
  sourceId?: string;
  // Source-backed transcript words keep a sourceId. User-added captions stay
  // in current-timeline coordinates and omit sourceId.
  startTime: number;
  endTime: number;
  text: string;
  words?: CaptionWordTiming[];
  renderStyle?: CaptionRenderStyle;
}

export interface SourceRangeRef {
  sourceId?: string | null;
  assetId?: string | null;
  sourceStart: number;
  sourceEnd: number;
}

export interface SilenceCandidate {
  gapStart: number;
  gapEnd: number;
  deleteStart: number;
  deleteEnd: number;
  duration: number;
}

export interface TransitionEntry {
  id?: string;
  afterClipId?: string;
  atTime: number;
  type: 'fade_black';
  duration: number;
}

export interface ResolvedTransitionBoundary {
  id?: string;
  afterClipId: string;
  atTime: number;
  type: TransitionEntry['type'];
  duration: number;
  fromClipId: string;
  toClipId: string;
}

export interface RenderTimelineEntry extends ClipScheduleEntry {
  transitionIn?: ResolvedTransitionBoundary | null;
  transitionOut?: ResolvedTransitionBoundary | null;
}

export interface CaptionCueWord {
  text: string;
  startTime: number;
  endTime: number;
}

export interface CaptionCue {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  lines: string[];
  words: CaptionCueWord[];
}

export interface MarkerEntry {
  id: string;
  number: number;
  timelineTime: number;
  label?: string;
  createdBy: 'ai' | 'human';
  status: 'open' | 'accepted' | 'rejected';
  linkedRange?: {
    startTime: number;
    endTime: number;
  };
  linkedMessageId?: string;
  confidence?: number | null;
  note?: string;
}

export interface TextOverlayEntry {
  id?: string;
  startTime: number;
  endTime: number;
  text: string;
  position: 'top' | 'center' | 'bottom';
  fontSize?: number;
}

export interface ColorFilter {
  type: 'cinematic' | 'vintage' | 'warm' | 'cool' | 'bw' | 'none';
  intensity: number; // 0.0 to 1.0
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  requestChainId?: string;
  action?: EditAction;
  visualSearch?: VisualSearchSession | null;
  autoApplied?: boolean;
  actionStatus?: 'pending' | 'completed' | 'rejected';
  actionResult?: string;
  final?: boolean;
  isStreaming?: boolean;
}

export interface AppliedActionRecord {
  id: string;
  timestamp: number;
  requestChainId?: string;
  action: EditAction;
  summary: string;
  sourceRanges?: SourceRangeRef[];
}

export type MediaAssetStatus = 'pending' | 'indexing' | 'ready' | 'error' | 'missing';

export interface ProjectSource {
  id: string;
  fileName: string;
  storagePath: string | null;
  assetId: string | null;
  duration: number;
  status: MediaAssetStatus;
  isPrimary: boolean;
}

export interface MediaAsset {
  id: string;
  projectId: string;
  storagePath: string;
  sourceDuration: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  status: MediaAssetStatus;
  createdAt: string;
  indexedAt: string | null;
}

export interface AssetTranscriptWord {
  id: string;
  assetId: string;
  startTime: number;
  endTime: number;
  text: string;
  confidence?: number | null;
}

export type SourceIndexedFrameSampleKind =
  | 'coarse_window_rep'
  | 'scene_rep'
  | 'window_250ms';

export interface SourceIndexedFrame {
  sourceId: string;
  sourceTime: number;
  description?: string;
  image?: string;
  assetId?: string | null;
  indexedAt?: string | null;
  sampleKind?: SourceIndexedFrameSampleKind;
  score?: number | null;
  sceneId?: string | null;
}

export interface SourceIndexState {
  overview: boolean;
  transcript: boolean;
  version: string;
  assetId?: string | null;
  indexedAt?: string | null;
}

export interface IndexedVideoFrame {
  image?: string;
  timelineTime: number;
  sourceTime: number;
  sourceId?: string;
  kind: 'overview' | 'dense';
  rangeStart?: number;
  rangeEnd?: number;
  description?: string;
  projectedTimelineTime?: number | null;
  visibleOnTimeline?: boolean;
  sampleKind?: SourceIndexedFrameSampleKind;
  score?: number | null;
  sceneId?: string | null;
}

export type AnalysisJobStage =
  | 'queued'
  | 'preparing_media'
  | 'transcribing_audio'
  | 'detecting_scenes'
  | 'choosing_representative_frames'
  | 'describing_representative_frames'
  | 'dense_refinement'
  | 'extracting_frames'
  | 'describing_frames'
  | 'transcribing';

export interface AnalysisProgress {
  stage: AnalysisJobStage;
  completed: number;
  total: number;
  label?: string | null;
  etaSeconds?: number | null;
}

export type AnalysisJobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed';

export type SourceIndexTaskStatus =
  | AnalysisJobStatus
  | 'unavailable';

export interface SourceIndexTaskState {
  status: SourceIndexTaskStatus;
  completed: number;
  total: number;
  etaSeconds?: number | null;
  reason?: string | null;
}

export interface SourceIndexAnalysisState {
  jobId?: string | null;
  status: AnalysisJobStatus | null;
  error?: string | null;
  pauseRequested?: boolean | null;
  progress: AnalysisProgress | null;
  audio?: SourceIndexTaskState | null;
  visual?: SourceIndexTaskState | null;
}

export type SourceIndexAnalysisStateMap = Record<string, SourceIndexAnalysisState>;

export type VisualConfidenceBand = 'low' | 'medium' | 'high';

export interface VisualQueryIntent {
  rawQuery: string;
  normalizedQuery: string;
  actionType: 'delete' | 'locate' | 'inspect';
  targetType: 'visual_motif' | 'text_on_screen' | 'scene' | 'unknown';
  transcriptRelevance: 'low' | 'medium' | 'high';
  visualEvidencePriority: 'low' | 'medium' | 'high';
  expectedDurationSeconds: number;
  confidenceThreshold: number;
  allowRepeatDetection: boolean;
}

export interface VisualCandidateWindow {
  id: string;
  assetId: string;
  sourceStart: number;
  sourceEnd: number;
  retrievalScore: number;
  retrievalReasons: string[];
  thumbnailPath?: string | null;
  ocrText?: string | null;
  verificationStatus?: 'not_requested' | 'queued' | 'verified' | 'rejected';
  confidenceBand?: VisualConfidenceBand;
}

export interface VerifiedSourceRange {
  assetId: string;
  sourceStart: number;
  sourceEnd: number;
  frameStart: number;
  frameEnd: number;
  verificationConfidence: number;
  boundaryConfidence: number;
  evidence: string[];
  candidateId?: string;
}

export interface VisualEditProposal {
  assetId: string;
  intent: VisualQueryIntent;
  confidenceBand: VisualConfidenceBand;
  sourceRanges: VerifiedSourceRange[];
  timelineRanges: Array<{ timelineStart: number; timelineEnd: number }>;
  followUpPrompt?: string;
}

export interface VisualSearchSession {
  projectId: string;
  assetId: string | null;
  query: string;
  confidenceBand: VisualConfidenceBand;
  intent: VisualQueryIntent | null;
  candidates: VisualCandidateWindow[];
  proposal: VisualEditProposal | null;
  followUpPrompt?: string;
  verificationJobId?: string | null;
  updatedAt: number;
}

export interface AIEditingSettings {
  silenceRemoval: {
    paddingSeconds: number;
    minDurationSeconds: number;
    preserveShortPauses: boolean;
    requireSpeakerAbsence: boolean;
  };
  frameInspection: {
    defaultFrameCount: number;
    overviewIntervalSeconds: number;
    maxOverviewFrames: number;
  };
  captions: {
    wordsPerCaption: number;
  };
  transitions: {
    defaultDuration: number;
    defaultType: 'fade_black';
  };
  textOverlays: {
    defaultPosition: 'top' | 'center' | 'bottom';
    defaultFontSize: number;
  };
}

export interface EditAction {
  type:
    | 'split_clip'
    | 'delete_clip'
    | 'delete_range'
    | 'delete_ranges'
    | 'reorder_clip'
    | 'set_clip_speed'
    | 'set_clip_volume'
    | 'set_clip_filter'
    | 'add_captions'
    | 'transcribe_request'
    | 'request_frames'
    | 'add_transition'
    | 'add_marker'
    | 'add_markers'
    | 'update_marker'
    | 'remove_marker'
    | 'add_text_overlay'
    | 'replace_text_overlay'
    | 'update_ai_settings'
    | 'none';
  // split_clip
  splitTime?: number;
  // delete_range
  deleteStartTime?: number;
  deleteEndTime?: number;
  // delete_ranges (batch — applied end-to-start to avoid offset issues)
  ranges?: Array<{ start: number; end: number }>;
  // delete_clip / set_clip_* / reorder_clip (target by index or id)
  clipIndex?: number;
  clipId?: string;
  // reorder_clip
  newIndex?: number;
  // set_clip_speed
  speed?: number;
  // set_clip_volume
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  // set_clip_filter
  filter?: ColorFilter;
  // captions / transcription
  captions?: CaptionEntry[];
  transcriptRange?: { startTime: number; endTime: number };
  captionStyle?: CaptionRenderStyle;
  segments?: Array<{ startTime: number; endTime: number; reason?: string }>;
  // request_frames
  frameRequest?: { startTime: number; endTime: number; count?: number };
  // transitions
  transitions?: TransitionEntry[];
  // markers
  marker?: Partial<MarkerEntry>;
  markers?: Array<Partial<MarkerEntry>>;
  markerId?: string;
  // text overlays
  textOverlays?: TextOverlayEntry[];
  // replace_text_overlay
  overlayIndex?: number;
  // update_ai_settings
  settings?: Partial<AIEditingSettings>;
  message: string;
}

// ─── Source Index Layer ──────────────────────────────────────────────────────

/** A single word from Whisper word-level output, annotated with filler status */
export interface SourceWord {
  word: string;
  start: number;    // source video seconds
  end: number;      // source video seconds
  isFiller: boolean;
}

/** A semantic segment (sentence or phrase) indexed against source time */
export interface SourceSegment {
  id: string;
  text: string;
  sourceStart: number;
  sourceEnd: number;
  words: SourceWord[];
  sceneId: string | null;
  fillerWords: string[];   // filler words found in this segment
  pauseAfterMs: number;    // gap in ms to the next segment (0 if last)
}

/** A scene boundary detected via visual change analysis */
export interface SceneBoundary {
  id: string;
  sourceStart: number;
  sourceEnd: number;
}

/** The complete source index for one video clip — stored alongside the project */
export interface SourceIndex {
  version: string;
  sourceId: string;
  sourceDuration: number;
  segments: SourceSegment[];
  scenes: SceneBoundary[];
  indexedAt: string;
}
