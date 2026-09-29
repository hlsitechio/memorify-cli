import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertSameOrigin, assertSecureUrl, browserCommand, parseConfigStrict, resolveHost } from "../safety.js";
import { PACKAGE, VERSION } from "../version.js";

test("version constant matches package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.version, VERSION);
  assert.equal(pkg.name, PACKAGE);
});

test("assertSecureUrl: https only (http only for localhost), no credentials", () => {
  assert.ok(assertSecureUrl("https://memorify.dev/mcp", "x"));
  assert.ok(assertSecureUrl("http://localhost:8080/mcp", "x"));
  for (const bad of [
    "http://memorify.dev", "ftp://x", "javascript:alert(1)", "file:///etc/passwd",
    "https://u:p@memorify.dev", "not a url", "http://127.0.0.1.evil.com",
  ]) {
    assert.throws(() => assertSecureUrl(bad, "x"), Error, bad);
  }
});

test("resolveHost: official host by default; custom hosts need an explicit flag", () => {
  assert.equal(resolveHost(undefined, false), "https://memorify.dev");
  assert.equal(resolveHost("https://memorify.dev/", false), "https://memorify.dev");
  assert.throws(() => resolveHost("https://evil.example", false));
  assert.equal(resolveHost("https://mine.example", true), "https://mine.example");
  assert.throws(() => resolveHost("http://mine.example", true));
});

test("assertSameOrigin: server-provided URLs must stay on the pairing host", () => {
  assert.ok(assertSameOrigin("https://memorify.dev/pair?c=1", "https://memorify.dev", "u"));
  assert.throws(() => assertSameOrigin("https://memorify.dev.evil.com/pair", "https://memorify.dev", "u"));
  assert.throws(() => assertSameOrigin("https://evil.com/pair", "https://memorify.dev", "u"));
  assert.throws(() => assertSameOrigin("http://memorify.dev/pair", "https://memorify.dev", "u"));
});

test("browserCommand never routes through a shell and rejects hostile URLs", () => {
  const w = browserCommand("win32", "https://memorify.dev/pair?code=AB12");
  assert.equal(w.cmd, "rundll32");
  assert.deepEqual(w.args, ["url.dll,FileProtocolHandler", "https://memorify.dev/pair?code=AB12"]);
  assert.equal(browserCommand("darwin", "https://memorify.dev/x").cmd, "open");
  assert.equal(browserCommand("linux", "https://memorify.dev/x").cmd, "xdg-open");
  assert.throws(() => browserCommand("win32", "calc.exe"));
  assert.throws(() => browserCommand("win32", "file:///C:/Windows/System32/calc.exe"));
  assert.throws(() => browserCommand("linux", "javascript:alert(1)"));
});

test("parseConfigStrict: empty is {}, invalid JSON throws instead of being overwritten", () => {
  assert.deepEqual(parseConfigStrict("", "f"), {});
  assert.deepEqual(parseConfigStrict('{"a":1}', "f"), { a: 1 });
  assert.throws(() => parseConfigStrict('{ // comment\n "a": 1 }', "f"), /not valid JSON/);
  assert.throws(() => parseConfigStrict("{", "f"));
});
