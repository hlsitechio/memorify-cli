import test from "node:test";
import assert from "node:assert/strict";
import { PairingDenied, PairingRateLimited, formatWait, pollUntilApproved, rateLimitFrom, startPairing } from "../pair.js";

const HOST = "https://memorify.dev";
const realFetch = globalThis.fetch;
const restore = () => {
  globalThis.fetch = realFetch;
};
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });

test("formatWait speaks in seconds, minutes and hours", () => {
  assert.equal(formatWait(45), "45 s");
  assert.equal(formatWait(60), "60 s");
  assert.equal(formatWait(300), "5 min");
  assert.equal(formatWait(1800), "30 min");
  assert.equal(formatWait(3600), "60 min");
  assert.equal(formatWait(5400), "1 h 30 min");
  assert.equal(formatWait(86400), "24 h");
  assert.equal(formatWait(0), "1 s");
});

test("rateLimitFrom prefers the JSON retry_after, then the header, then 60 s", () => {
  const h = (v?: string) => new Headers(v ? { "retry-after": v } : {});
  assert.equal(rateLimitFrom({ headers: h("120") }, JSON.stringify({ retry_after: 300, reason: "agent_cooldown" })).retryAfterSeconds, 300);
  assert.equal(rateLimitFrom({ headers: h("120") }, "not json").retryAfterSeconds, 120);
  assert.equal(rateLimitFrom({ headers: h() }, "").retryAfterSeconds, 60);
});

test("the message says how long to wait and that the account is fine", () => {
  const e = new PairingRateLimited(300, "agent_cooldown");
  assert.match(e.message, /5 min/);
  assert.match(e.message, /account/);
  assert.match(new PairingRateLimited(60, "too_many_pending").message, /waiting for approval/);
});

test("startPairing turns a 429 into PairingRateLimited with the wait", async () => {
  globalThis.fetch = (async () => reply(429, { error: "rate_limited", reason: "agent_cooldown", retry_after: 300 }, { "Retry-After": "300" })) as typeof fetch;
  try {
    await assert.rejects(startPairing(HOST, "a", "cli"), (e: unknown) => e instanceof PairingRateLimited && e.retryAfterSeconds === 300 && e.reason === "agent_cooldown");
  } finally {
    restore();
  }
});

test("startPairing sends login_hint only when given", async () => {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return reply(200, { device_code: "d", user_code: "ABC234", verification_uri: `${HOST}/pair`, expires_in: 600, interval: 2 });
  }) as typeof fetch;
  try {
    await startPairing(HOST, "a", "cli");
    await startPairing(HOST, "a", "cli", undefined, "me@example.com");
    assert.equal("login_hint" in bodies[0], false);
    assert.equal(bodies[1].login_hint, "me@example.com");
  } finally {
    restore();
  }
});

const START = { device_code: "d", user_code: "ABC234", verification_uri: `${HOST}/pair`, expires_in: 30, interval: 0 };

test("poll: a cooldown 429 stops with the wait instead of hammering", async () => {
  globalThis.fetch = (async () => reply(429, { reason: "agent_cooldown", retry_after: 600 }, { "Retry-After": "600" })) as typeof fetch;
  try {
    await assert.rejects(pollUntilApproved(HOST, "d", START), (e: unknown) => e instanceof PairingRateLimited && e.retryAfterSeconds === 600);
  } finally {
    restore();
  }
});

test("poll: expired_token (what the server really sends) ends with a clear message, not a silent timeout", async () => {
  globalThis.fetch = (async () => reply(400, { error: "expired_token" })) as typeof fetch;
  try {
    await assert.rejects(pollUntilApproved(HOST, "d", START), (e: unknown) => e instanceof PairingDenied && /expired/.test(e.message) && /10 minutes/.test(e.message));
  } finally {
    restore();
  }
});

test("poll: access_denied ends as denied", async () => {
  globalThis.fetch = (async () => reply(403, { error: "access_denied" })) as typeof fetch;
  try {
    await assert.rejects(pollUntilApproved(HOST, "d", START), (e: unknown) => e instanceof PairingDenied && /denied/.test(e.message));
  } finally {
    restore();
  }
});
