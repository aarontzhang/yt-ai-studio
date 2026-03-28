import type { EditAction } from './types';

export const REQUEST_CHAIN_CONTINUATION_START = '[REQUEST_CHAIN_CONTINUATION]';
export const REQUEST_CHAIN_CONTINUATION_END = '[/REQUEST_CHAIN_CONTINUATION]';

export type RequestChainTranscriptAvailability = {
  canonicalAvailable: boolean;
  requestedDuringChain: boolean;
  missing: boolean;
};

export type RequestChainContinuationPayload = {
  requestChainId: string;
  originalRequest: string;
  remainingObjective: string | null;
  completedActions: Array<{
    type: EditAction['type'];
    signature: string;
    summary?: string;
  }>;
  duplicateActionBlacklist: EditAction['type'][];
  transcript: RequestChainTranscriptAvailability;
  trigger:
    | 'transcript_ready'
    | 'action_resolved'
    | 'duplicate_action_retry';
  explicitInstruction?: string | null;
};

export function serializeActionForComparison(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(serializeActionForComparison).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${key}:${serializeActionForComparison(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function actionsMatch(a?: EditAction, b?: EditAction): boolean {
  if (!a || !b) return false;
  return serializeActionForComparison(a) === serializeActionForComparison(b);
}

export function buildRequestChainContinuationMessage(
  payload: RequestChainContinuationPayload,
): string {
  return [
    REQUEST_CHAIN_CONTINUATION_START,
    JSON.stringify(payload),
    REQUEST_CHAIN_CONTINUATION_END,
  ].join('\n');
}

export function parseRequestChainContinuationMessage(
  message: string,
): RequestChainContinuationPayload | null {
  const startIndex = message.indexOf(REQUEST_CHAIN_CONTINUATION_START);
  if (startIndex === -1) return null;
  const afterStart = startIndex + REQUEST_CHAIN_CONTINUATION_START.length;
  const endIndex = message.indexOf(REQUEST_CHAIN_CONTINUATION_END, afterStart);
  if (endIndex === -1) return null;
  const block = message.slice(afterStart, endIndex).trim();
  if (!block) return null;

  try {
    const parsed = JSON.parse(block) as RequestChainContinuationPayload;
    if (
      !parsed
      || typeof parsed.requestChainId !== 'string'
      || typeof parsed.originalRequest !== 'string'
      || !parsed.originalRequest.trim()
    ) {
      return null;
    }
    return {
      ...parsed,
      remainingObjective: typeof parsed.remainingObjective === 'string' && parsed.remainingObjective.trim()
        ? parsed.remainingObjective.trim()
        : null,
      completedActions: Array.isArray(parsed.completedActions)
        ? parsed.completedActions.flatMap((action) => {
            if (!action || typeof action !== 'object') return [];
            const candidate = action as {
              type?: unknown;
              signature?: unknown;
              summary?: unknown;
            };
            if (typeof candidate.type !== 'string' || typeof candidate.signature !== 'string') return [];
            return [{
              type: candidate.type as EditAction['type'],
              signature: candidate.signature,
              summary: typeof candidate.summary === 'string' && candidate.summary.trim()
                ? candidate.summary.trim()
                : undefined,
            }];
          })
        : [],
      duplicateActionBlacklist: Array.isArray(parsed.duplicateActionBlacklist)
        ? parsed.duplicateActionBlacklist
        : [],
      transcript: {
        canonicalAvailable: parsed.transcript?.canonicalAvailable === true,
        requestedDuringChain: parsed.transcript?.requestedDuringChain === true,
        missing: parsed.transcript?.missing === true,
      },
      trigger: parsed.trigger,
      explicitInstruction: typeof parsed.explicitInstruction === 'string' && parsed.explicitInstruction.trim()
        ? parsed.explicitInstruction.trim()
        : null,
    };
  } catch {
    return null;
  }
}

export function getRequestChainEffectiveObjective(
  payload: RequestChainContinuationPayload,
): string {
  return payload.remainingObjective?.trim() || payload.originalRequest.trim();
}
