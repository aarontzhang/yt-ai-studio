import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export type BetaUsageMetric =
  | 'chat_requests'
  | 'transcribe_seconds';

type BetaLimitConfig = {
  envName: string;
  defaultLimit: number;
  label: string;
};

type ConsumeBetaUsageRow = {
  allowed: boolean;
  used_amount: number | string | null;
  limit_amount: number | string | null;
  remaining_amount: number | string | null;
};

export type BetaUsageResult = {
  allowed: boolean;
  usedAmount: number;
  limitAmount: number | null;
  remainingAmount: number | null;
};

const LIMITS: Record<BetaUsageMetric, BetaLimitConfig> = {
  chat_requests: {
    envName: 'BETA_MAX_CHAT_REQUESTS_PER_DAY',
    defaultLimit: 100,
    label: 'chat requests',
  },
  transcribe_seconds: {
    envName: 'BETA_MAX_TRANSCRIBE_SECONDS_PER_DAY',
    defaultLimit: 3600,
    label: 'transcription',
  },
};

function toNumber(value: number | string | null | undefined) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getConfiguredLimit(metric: BetaUsageMetric) {
  const config = LIMITS[metric];
  const raw = process.env[config.envName];
  if (!raw) return config.defaultLimit;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return config.defaultLimit;
  return Math.max(0, Math.floor(parsed));
}

export async function consumeBetaUsage(
  metric: BetaUsageMetric,
  userId: string,
  amount: number,
): Promise<BetaUsageResult> {
  const limit = getConfiguredLimit(metric);
  const normalizedAmount = Math.max(0, Math.ceil(amount));

  if (limit <= 0 || normalizedAmount === 0) {
    return {
      allowed: true,
      usedAmount: 0,
      limitAmount: limit <= 0 ? null : limit,
      remainingAmount: limit <= 0 ? null : limit,
    };
  }

  const { data, error } = await getSupabaseAdmin().rpc('consume_beta_usage', {
    p_user_id: userId,
    p_metric: metric,
    p_amount: normalizedAmount,
    p_limit: limit,
  });

  if (error) {
    console.warn('[betaLimits] consume_beta_usage RPC failed, allowing request through:', error.message);
    return {
      allowed: true,
      usedAmount: 0,
      limitAmount: limit <= 0 ? null : limit,
      remainingAmount: limit <= 0 ? null : limit,
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as ConsumeBetaUsageRow | null;
  if (!row) {
    throw new Error(`Failed to consume beta usage for ${metric}`);
  }

  return {
    allowed: Boolean(row.allowed),
    usedAmount: toNumber(row.used_amount),
    limitAmount: row.limit_amount == null ? null : toNumber(row.limit_amount),
    remainingAmount: row.remaining_amount == null ? null : toNumber(row.remaining_amount),
  };
}

export function buildBetaLimitExceededResponse(metric: BetaUsageMetric, result: BetaUsageResult) {
  const config = LIMITS[metric];
  const limitText = result.limitAmount == null ? 'the current beta limit' : String(result.limitAmount);

  return NextResponse.json({
    error: `Daily beta limit reached for ${config.label}. Try again tomorrow.`,
    metric,
    limit: result.limitAmount,
    remaining: result.remainingAmount,
    used: result.usedAmount,
    message: `You have reached ${limitText} daily ${config.label} for this beta.`,
  }, { status: 429 });
}
