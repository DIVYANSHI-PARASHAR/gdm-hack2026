import crypto from 'node:crypto';
import { SyncedCaloriesResponse } from '../src/shared/types';
import { isConfiguredSecret } from './env';

export const GOOGLE_HEALTH_READONLY_SCOPE =
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly';

export const GOOGLE_HEALTH_TOTAL_CALORIES_ROLLUP_URL =
  'https://health.googleapis.com/v4/users/me/dataTypes/total-calories/dataPoints:rollUp';

const GOOGLE_OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

const MIN_ATTRIBUTABLE_MATCH_MS = 15_000;
const MAX_MATCH_DURATION_MS = 3 * 60 * 60 * 1000;
const MAX_ALLOWED_BUCKET_MS = 90_000; // Must align with 1-minute (60s) resolution

export interface GoogleHealthRollupPoint {
  interval?: {
    startTime?: string;
    endTime?: string;
  };
  totalCalories?: {
    kcal?: number;
  };
  // Fallback field shape defensive check if nested under value
  value?: {
    kcal?: number;
  };
}

interface OAuthPendingState {
  codeVerifier: string;
  sessionId: string;
  createdAtMs: number;
}

interface StoredTokenSession {
  accessToken: string;
  refreshToken?: string;
  expiresAtMs: number;
}

const pendingOAuthStates = new Map<string, OAuthPendingState>();
const tokenSessions = new Map<string, StoredTokenSession>();

export function isGoogleHealthConfigured(): boolean {
  return (
    isConfiguredSecret(process.env.GOOGLE_CLIENT_ID) &&
    isConfiguredSecret(process.env.GOOGLE_CLIENT_SECRET)
  );
}

export function getGoogleRedirectUri(defaultPort: number): string {
  if (isConfiguredSecret(process.env.GOOGLE_REDIRECT_URI)) {
    return process.env.GOOGLE_REDIRECT_URI;
  }
  return `http://localhost:${defaultPort}/api/health/oauth/callback`;
}

export function hasConnectedHealthSession(sessionId: string | undefined): boolean {
  if (!sessionId) return false;
  return tokenSessions.has(sessionId);
}

export function clearHealthSession(sessionId: string | undefined): void {
  if (!sessionId) return;
  tokenSessions.delete(sessionId);
}

export function createOAuthAuthorizationUrl(
  sessionId: string,
  defaultPort: number
): string | null {
  if (!isGoogleHealthConfigured()) return null;

  // Cleanup expired pending states (>10 min)
  const now = Date.now();
  for (const [k, v] of pendingOAuthStates.entries()) {
    if (now - v.createdAtMs > 10 * 60 * 1000) {
      pendingOAuthStates.delete(k);
    }
  }

  const state = crypto.randomBytes(24).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  pendingOAuthStates.set(state, {
    codeVerifier,
    sessionId,
    createdAtMs: now,
  });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: getGoogleRedirectUri(defaultPort),
    response_type: 'code',
    scope: GOOGLE_HEALTH_READONLY_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return `${GOOGLE_OAUTH_AUTH_URL}?${params.toString()}`;
}

export async function handleOAuthCallback(
  code: string,
  state: string,
  defaultPort: number,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; sessionId?: string; errorMessage?: string }> {
  const pending = pendingOAuthStates.get(state);
  pendingOAuthStates.delete(state);

  if (!pending) {
    return { ok: false, errorMessage: 'Invalid or expired OAuth state.' };
  }
  if (!isGoogleHealthConfigured()) {
    return { ok: false, errorMessage: 'Google OAuth credentials not configured.' };
  }

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    code,
    code_verifier: pending.codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: getGoogleRedirectUri(defaultPort),
  });

  const res = await fetchImpl(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    return {
      ok: false,
      errorMessage: `Token exchange failed (HTTP ${res.status}).`,
    };
  }

  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!data.access_token) {
    return { ok: false, errorMessage: 'No access token returned by Google.' };
  }

  const existing = tokenSessions.get(pending.sessionId);
  tokenSessions.set(pending.sessionId, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? existing?.refreshToken,
    expiresAtMs: Date.now() + (data.expires_in ?? 3500) * 1000,
  });

  return { ok: true, sessionId: pending.sessionId };
}

async function getValidAccessToken(
  sessionId: string,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  const session = tokenSessions.get(sessionId);
  if (!session) return null;

  if (Date.now() < session.expiresAtMs - 30_000) {
    return session.accessToken;
  }

  if (!session.refreshToken || !isGoogleHealthConfigured()) {
    tokenSessions.delete(sessionId);
    return null;
  }

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    refresh_token: session.refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetchImpl(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    tokenSessions.delete(sessionId);
    return null;
  }

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) {
    tokenSessions.delete(sessionId);
    return null;
  }

  session.accessToken = data.access_token;
  session.expiresAtMs = Date.now() + (data.expires_in ?? 3500) * 1000;
  return session.accessToken;
}

/**
 * Pure interval attribution logic for Google Health v4 `total-calories` (1-minute storage resolution).
 * Ensures:
 * - Unrelated outside activity from coarse buckets is never attributed to the match.
 * - Partial sync coverage returns `awaiting_sync` rather than under-reporting partial calories.
 * - Short unattributable intervals (< 15s) return `unavailable`.
 */
export function attributeMatchCalories(
  points: GoogleHealthRollupPoint[] | null | undefined,
  matchStartMs: number,
  matchEndMs: number
): SyncedCaloriesResponse {
  if (
    !Number.isFinite(matchStartMs) ||
    !Number.isFinite(matchEndMs) ||
    matchEndMs <= matchStartMs
  ) {
    return {
      status: 'unavailable',
      message: 'Unavailable — invalid match interval timestamps.',
    };
  }

  const matchDurationMs = matchEndMs - matchStartMs;
  const matchDurationSec = Math.round(matchDurationMs / 1000);

  if (matchDurationMs < MIN_ATTRIBUTABLE_MATCH_MS) {
    return {
      status: 'unavailable',
      matchDurationSec,
      message:
        'Unavailable — match was shorter than 15s (below 1-minute calorie resolution).',
    };
  }

  if (matchDurationMs > MAX_MATCH_DURATION_MS) {
    return {
      status: 'unavailable',
      matchDurationSec,
      message: 'Unavailable — match interval exceeds attribution limit.',
    };
  }

  if (!points || points.length === 0) {
    return {
      status: 'awaiting_sync',
      coveredRatio: 0,
      matchDurationSec,
      message:
        'Awaiting sync — open Google Health on your phone to sync Fitbit Air, then retry.',
    };
  }

  let attributedKcal = 0;
  let coveredOverlapMs = 0;

  for (const pt of points) {
    const startIso = pt.interval?.startTime;
    const endIso = pt.interval?.endTime;
    const kcal = pt.totalCalories?.kcal ?? pt.value?.kcal;

    if (!startIso || !endIso || typeof kcal !== 'number' || !Number.isFinite(kcal) || kcal < 0) {
      continue;
    }

    const bucketStartMs = Date.parse(startIso);
    const bucketEndMs = Date.parse(endIso);
    if (
      !Number.isFinite(bucketStartMs) ||
      !Number.isFinite(bucketEndMs) ||
      bucketEndMs <= bucketStartMs
    ) {
      continue;
    }

    const overlapStart = Math.max(matchStartMs, bucketStartMs);
    const overlapEnd = Math.min(matchEndMs, bucketEndMs);
    const overlapMs = overlapEnd - overlapStart;
    if (overlapMs <= 0) continue;

    const bucketDurationMs = bucketEndMs - bucketStartMs;
    // Refuse to attribute coarse summary blocks (>90s) that spill outside the match window
    if (
      bucketDurationMs > MAX_ALLOWED_BUCKET_MS &&
      (bucketStartMs < matchStartMs - 10_000 || bucketEndMs > matchEndMs + 10_000)
    ) {
      return {
        status: 'unavailable',
        matchDurationSec,
        message:
          'Unavailable — returned calorie interval is too coarse to isolate this match.',
      };
    }

    const fraction = overlapMs / bucketDurationMs;
    attributedKcal += kcal * fraction;
    coveredOverlapMs += overlapMs;
  }

  const coveredRatio = Math.min(1, coveredOverlapMs / matchDurationMs);

  // Require >= 98% of the match interval to be covered by synced 1-minute buckets
  if (coveredRatio < 0.98) {
    return {
      status: 'awaiting_sync',
      coveredRatio: Number(coveredRatio.toFixed(2)),
      matchDurationSec,
      message:
        coveredRatio === 0
          ? 'Awaiting sync — no synced calorie records for this match window yet.'
          : `Awaiting sync — match interval only ${Math.round(
              coveredRatio * 100
            )}% covered so far.`,
    };
  }

  return {
    status: 'synced',
    kcal: Number(attributedKcal.toFixed(1)),
    coveredRatio: 1,
    matchDurationSec,
    message:
      'Synced total calories (includes resting metabolic burn + active match expenditure).',
  };
}

export async function fetchSyncedMatchCalories(
  sessionId: string | undefined,
  matchStartMs: number,
  matchEndMs: number,
  fetchImpl: typeof fetch = fetch
): Promise<SyncedCaloriesResponse> {
  if (!isGoogleHealthConfigured()) {
    return {
      status: 'unconfigured',
      message:
        'Google Health OAuth is not configured on this server (optional .env credentials).',
    };
  }

  if (!sessionId) {
    return {
      status: 'disconnected',
      message: 'Connect Google Health to import synced post-match calories.',
    };
  }

  const accessToken = await getValidAccessToken(sessionId, fetchImpl);
  if (!accessToken) {
    return {
      status: 'disconnected',
      message: 'Google Health session expired. Please reconnect.',
    };
  }

  // Align query range to exact UTC minute boundaries [floorToMinute, ceilToMinute)
  const alignedStartMs = Math.floor(matchStartMs / 60_000) * 60_000;
  const alignedEndMs = Math.ceil(matchEndMs / 60_000) * 60_000;

  if (
    !Number.isFinite(alignedStartMs) ||
    !Number.isFinite(alignedEndMs) ||
    alignedEndMs <= alignedStartMs
  ) {
    return {
      status: 'unavailable',
      message: 'Unavailable — invalid match interval.',
    };
  }

  try {
    const res = await fetchImpl(GOOGLE_HEALTH_TOTAL_CALORIES_ROLLUP_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        range: {
          startTime: new Date(alignedStartMs).toISOString(),
          endTime: new Date(alignedEndMs).toISOString(),
        },
        windowSize: '60s',
      }),
    });

    if (res.status === 401 || res.status === 403) {
      clearHealthSession(sessionId);
      return {
        status: 'disconnected',
        message: 'Google Health authorization required.',
      };
    }

    if (!res.ok) {
      return {
        status: 'unavailable',
        message: `Unavailable — Google Health API returned HTTP ${res.status}.`,
      };
    }

    const payload = (await res.json()) as {
      rollupDataPoints?: GoogleHealthRollupPoint[];
    };

    return attributeMatchCalories(
      payload.rollupDataPoints ?? [],
      matchStartMs,
      matchEndMs
    );
  } catch {
    return {
      status: 'unavailable',
      message: 'Unavailable — network error contacting Google Health API.',
    };
  }
}
