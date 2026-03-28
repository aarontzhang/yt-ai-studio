import { NextResponse } from 'next/server';

type RateLimitConfig = {
  key: string;
  limit: number;
  windowMs: number;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type UnsafeRequest = {
  method: string;
  headers: Headers;
};

const rateLimitBuckets = new Map<string, RateLimitBucket>();
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function getExpectedOrigin(headers: Headers) {
  const forwardedProto = headers.get('x-forwarded-proto');
  const forwardedHost = headers.get('x-forwarded-host');
  const host = forwardedHost ?? headers.get('host');
  if (!host) return null;

  const protocol = forwardedProto ?? (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${protocol}://${host}`;
}

function parseOrigin(value: string | null) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function parseRefererOrigin(value: string | null) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function cleanupRateLimitBuckets(now: number) {
  if (rateLimitBuckets.size < 5000) return;
  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.resetAt <= now) {
      rateLimitBuckets.delete(key);
    }
  }
}

export function enforceSameOrigin(request: UnsafeRequest) {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return null;

  const expectedOrigin = getExpectedOrigin(request.headers);
  if (!expectedOrigin) {
    return NextResponse.json({ error: 'Unable to determine expected origin' }, { status: 400 });
  }

  const requestOrigin = parseOrigin(request.headers.get('origin'));
  const refererOrigin = parseRefererOrigin(request.headers.get('referer'));

  if (requestOrigin === expectedOrigin || refererOrigin === expectedOrigin) {
    return null;
  }

  return NextResponse.json(
    { error: 'Cross-site request blocked' },
    { status: 403, headers: { Vary: 'Origin, Referer, Host, X-Forwarded-Host, X-Forwarded-Proto' } },
  );
}

export function getRateLimitIdentity(headers: Headers, userId?: string | null) {
  if (userId) return `user:${userId}`;

  const forwardedFor = headers.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown';
  return `ip:${ip}`;
}

export function enforceRateLimit(config: RateLimitConfig) {
  const now = Date.now();
  cleanupRateLimitBuckets(now);

  const bucket = rateLimitBuckets.get(config.key);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(config.key, { count: 1, resetAt: now + config.windowMs });
    return null;
  }

  if (bucket.count >= config.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return NextResponse.json(
      {
        error: 'Too many requests',
        retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfterSeconds),
        },
      },
    );
  }

  bucket.count += 1;
  return null;
}
