// src/pair.ts — device-flow pairing client for Memorify.
// Mirrors the server contract exactly: respect `interval`, honor 429 slow_down
// Retry-After, stop cleanly on killed/denied/expired.

import { OFFICIAL_HOST, assertSameOrigin } from "./safety.js";

export const DEFAULT_HOST = OFFICIAL_HOST;

export interface PairStartResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface PairResult {
  access_token: string;
  mcp_url: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "45 s", "5 min", "1 h 30 min": how long to wait, for people. */
export function formatWait(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** The server is pausing pairing for this computer (too many failed or unanswered requests). */
export class PairingRateLimited extends Error {
  constructor(
    public retryAfterSeconds: number,
    public reason: string,
  ) {
    super(PairingRateLimited.describe(retryAfterSeconds, reason));
  }
  static describe(retryAfterSeconds: number, reason: string): string {
    const wait = formatWait(retryAfterSeconds);
    if (reason === "too_many_pending") {
      return "You already have pairing requests waiting for approval. Approve or deny them at https://memorify.dev (bell icon), or wait for them to expire, then try again in " + wait + ".";
    }
    return `Pairing is paused on this computer for ${wait}. Too many pairing requests were denied, expired or failed. Try again in ${wait}; nothing is wrong with your account.`;
  }
}

/** Read the wait from a 429 response: JSON retry_after, else the Retry-After header. */
export function rateLimitFrom(res: { headers: { get(name: string): string | null } }, bodyText: string): PairingRateLimited {
  let json: any = {};
  try {
    json = JSON.parse(bodyText);
  } catch {
    /* not JSON */
  }
  const fromBody = Number(json?.retry_after);
  const fromHeader = parseInt(res.headers.get("retry-after") ?? "", 10);
  const seconds = Number.isFinite(fromBody) && fromBody > 0 ? fromBody : Number.isFinite(fromHeader) && fromHeader > 0 ? fromHeader : 60;
  return new PairingRateLimited(seconds, typeof json?.reason === "string" ? json.reason : "rate_limited");
}

export async function startPairing(
  host: string,
  agentName: string,
  agentKind: string,
  fingerprint?: string,
  loginHint?: string,
): Promise<PairStartResponse> {
  const res = await fetch(`${host}/api/pair/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_name: agentName,
      agent_kind: agentKind,
      ...(fingerprint ? { fingerprint } : {}),
      // Optional: lets Memorify email this person about the request. Never a secret.
      ...(loginHint ? { login_hint: loginHint } : {}),
    }),
  });
  if (res.status === 429) throw rateLimitFrom(res, await res.text());
  if (!res.ok) throw new Error(`pair/start failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as PairStartResponse;
  // The verification page is opened in a browser: it must be on the host we are pairing with.
  body.verification_uri = assertSameOrigin(body.verification_uri, host, "verification_uri");
  return body;
}

export class PairingDenied extends Error {
  constructor(public reason: string) {
    super(`pairing ended: ${reason}`);
  }
}

/** Poll until approved. Throws PairingDenied on killed/denied/expired. */
export async function pollUntilApproved(
  host: string,
  deviceCode: string,
  start: PairStartResponse,
  onStatus?: (msg: string) => void,
): Promise<PairResult> {
  let interval = (start.interval || 2) * 1000;
  const deadline = Date.now() + start.expires_in * 1000;

  while (Date.now() < deadline) {
    await sleep(interval);
    let res: Response;
    try {
      res = await fetch(`${host}/api/pair/poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: deviceCode }),
      });
    } catch (e: any) {
      onStatus?.(`network error, retrying: ${e.message}`);
      interval = Math.min(interval * 2, 30_000);
      continue;
    }

    if (res.status === 429) {
      const text429 = await res.text();
      let reason = "";
      try {
        reason = String(JSON.parse(text429)?.reason ?? "");
      } catch {
        /* not JSON */
      }
      const limited = rateLimitFrom(res, text429);
      // A cooldown on this computer is not a polling hint: stop and say how long.
      if (reason.startsWith("agent_cooldown") || reason === "too_many_pending") throw limited;
      const retryAfter = limited.retryAfterSeconds > 0 && reason !== "" ? limited.retryAfterSeconds : parseInt(res.headers.get("retry-after") ?? "5", 10) || 5;
      onStatus?.(`slow_down — waiting ${formatWait(retryAfter)} (rapid polling gets the pairing killed)`);
      interval = retryAfter * 1000;
      continue;
    }

    const body = await res.text();
    let json: any = {};
    try {
      json = JSON.parse(body);
    } catch {
      /* non-JSON error body */
    }

    if (res.ok) {
      if (json.status === "approved" && json.access_token) {
        // The token is written into client configs next to this URL: it must stay on the pairing host.
        return { access_token: json.access_token, mcp_url: assertSameOrigin(json.mcp_url || `${host}/mcp`, host, "mcp_url") };
      }
      if (json.status === "authorization_pending") {
        onStatus?.("waiting for human approval…");
        interval = (start.interval || 2) * 1000;
        continue;
      }
    }

    // Terminal states — stop polling and clean up.
    if (json.status === "killed") throw new PairingDenied("killed by server (poll abuse or human cancel)");
    if (json.error === "access_denied" || json.status === "access_denied")
      throw new PairingDenied("denied by the human approver");
    if (json.error === "expired" || json.error === "expired_token" || json.status === "expired")
      throw new PairingDenied("the pairing code expired (codes last 10 minutes). Run the command again and approve it from the bell icon at https://memorify.dev");

    // Unknown error — back off, don't hammer.
    onStatus?.(`poll error ${res.status}: ${body.slice(0, 120)}`);
    interval = Math.min(interval * 2, 30_000);
  }
  throw new PairingDenied("timed out");
}

/** Fire-and-forget cancel (idempotent server-side). */
export async function cancelPairing(host: string, deviceCode: string): Promise<void> {
  try {
    await fetch(`${host}/api/pair/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_code: deviceCode }),
    });
  } catch {
    /* polite fire-and-forget */
  }
}
