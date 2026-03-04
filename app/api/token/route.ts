import { NextResponse } from 'next/server';
import { AccessToken, type AccessTokenOptions, type VideoGrant } from 'livekit-server-sdk';
import { RoomConfiguration } from '@livekit/protocol';

type ConnectionDetails = {
  serverUrl: string;
  roomName: string;
  participantName: string;
  participantToken: string;
};

// NOTE: you are expected to define the following environment variables in `.env.local`:
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;
const TOKEN_ENDPOINT_ALLOWED_ORIGINS = process.env.TOKEN_ENDPOINT_ALLOWED_ORIGINS ?? '';
const TOKEN_ENDPOINT_RATE_LIMIT = Number.parseInt(
  process.env.TOKEN_ENDPOINT_RATE_LIMIT ?? '60',
  10
);
const TOKEN_ENDPOINT_RATE_LIMIT_WINDOW_MS = Number.parseInt(
  process.env.TOKEN_ENDPOINT_RATE_LIMIT_WINDOW_MS ?? '60000',
  10
);

// don't cache the results
export const revalidate = 0;

type RateLimitState = {
  count: number;
  resetAt: number;
};

const globalForRateLimit = globalThis as typeof globalThis & {
  tokenEndpointRateLimitStore?: Map<string, RateLimitState>;
};

const tokenEndpointRateLimitStore =
  globalForRateLimit.tokenEndpointRateLimitStore ?? new Map<string, RateLimitState>();
globalForRateLimit.tokenEndpointRateLimitStore = tokenEndpointRateLimitStore;

function getAllowedOrigins() {
  return new Set(
    TOKEN_ENDPOINT_ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  );
}

function getRequestOrigins(req: Request) {
  const origins = new Set<string>();

  try {
    origins.add(new URL(req.url).origin);
  } catch {
    // Ignore malformed request URLs and rely on forwarded headers.
  }

  const forwardedHost = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!forwardedHost) {
    return origins;
  }

  const host = forwardedHost.split(',')[0]?.trim();
  if (!host) {
    return origins;
  }

  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const inferredProto =
    host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  const proto = forwardedProto || inferredProto;
  origins.add(`${proto}://${host}`);

  return origins;
}

function getClientIp(req: Request) {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() ?? 'unknown';
  }

  return req.headers.get('x-real-ip') ?? req.headers.get('cf-connecting-ip') ?? 'unknown';
}

function isAllowedOrigin(req: Request) {
  const originHeader = req.headers.get('origin');
  if (!originHeader) {
    return { ok: false as const, error: 'Missing Origin header', status: 403 };
  }

  let requestOrigin: string;
  try {
    requestOrigin = new URL(originHeader).origin;
  } catch {
    return { ok: false as const, error: 'Invalid Origin header', status: 403 };
  }

  const allowedOrigins = getAllowedOrigins();
  if (allowedOrigins.size === 0) {
    // Fall back to same-origin checks in production when explicit allowlist is not configured.
    const requestOrigins = getRequestOrigins(req);
    if (requestOrigins.has(requestOrigin)) {
      return { ok: true as const };
    }
    return {
      ok: false as const,
      error:
        'TOKEN_ENDPOINT_ALLOWED_ORIGINS is not configured, and request origin does not match this host.',
      status: 403,
    };
  }

  if (!allowedOrigins.has(requestOrigin)) {
    return { ok: false as const, error: 'Origin not allowed', status: 403 };
  }

  return { ok: true as const };
}

function isRateLimited(req: Request) {
  const ip = getClientIp(req);
  const now = Date.now();
  const current = tokenEndpointRateLimitStore.get(ip);

  if (!current || current.resetAt <= now) {
    tokenEndpointRateLimitStore.set(ip, {
      count: 1,
      resetAt: now + TOKEN_ENDPOINT_RATE_LIMIT_WINDOW_MS,
    });
    return false;
  }

  if (current.count >= TOKEN_ENDPOINT_RATE_LIMIT) {
    return true;
  }

  current.count += 1;
  tokenEndpointRateLimitStore.set(ip, current);
  return false;
}

function enforceProductionGuards(req: Request) {
  if (process.env.NODE_ENV !== 'production') {
    return null;
  }

  const originCheck = isAllowedOrigin(req);
  if (!originCheck.ok) {
    return NextResponse.json({ error: originCheck.error }, { status: originCheck.status });
  }

  if (isRateLimited(req)) {
    return NextResponse.json({ error: 'Too many token requests' }, { status: 429 });
  }

  return null;
}

export async function POST(req: Request) {
  const guardResponse = enforceProductionGuards(req);
  if (guardResponse) {
    return guardResponse;
  }

  try {
    if (LIVEKIT_URL === undefined) {
      throw new Error('LIVEKIT_URL is not defined');
    }
    if (API_KEY === undefined) {
      throw new Error('LIVEKIT_API_KEY is not defined');
    }
    if (API_SECRET === undefined) {
      throw new Error('LIVEKIT_API_SECRET is not defined');
    }

    // Parse room config from request body.
    const body = await req.json();
    // Recreate the RoomConfiguration object from JSON object.
    const roomConfig = RoomConfiguration.fromJson(body?.room_config, { ignoreUnknownFields: true });

    // Generate participant token
    const participantName = 'user';
    const participantIdentity = `voice_assistant_user_${Math.floor(Math.random() * 10_000)}`;
    const roomName = `voice_assistant_room_${Math.floor(Math.random() * 10_000)}`;

    const participantToken = await createParticipantToken(
      { identity: participantIdentity, name: participantName },
      roomName,
      roomConfig
    );

    // Return connection details
    const data: ConnectionDetails = {
      serverUrl: LIVEKIT_URL,
      roomName,
      participantName,
      participantToken,
    };
    const headers = new Headers({
      'Cache-Control': 'no-store',
    });
    return NextResponse.json(data, { headers });
  } catch (error) {
    if (error instanceof Error) {
      console.error(error);
      return new NextResponse(error.message, { status: 500 });
    }

    return new NextResponse('Unknown error while issuing token', { status: 500 });
  }
}

function createParticipantToken(
  userInfo: AccessTokenOptions,
  roomName: string,
  roomConfig: RoomConfiguration
): Promise<string> {
  const at = new AccessToken(API_KEY, API_SECRET, {
    ...userInfo,
    ttl: '15m',
  });
  const grant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  };
  at.addGrant(grant);

  if (roomConfig) {
    at.roomConfig = roomConfig;
  }

  return at.toJwt();
}
