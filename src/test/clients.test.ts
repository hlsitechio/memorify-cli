import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getClient } from "../clients.js";
import { PACKAGE, VERSION } from "../version.js";

async function inTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "memorify-cli-"));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    process.chdir(prev);
  }
}

test("claude-code writes .mcp.json, preserving other servers", async () => {
  await inTempDir(async (dir) => {
    await writeFile(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    const file = await getClient("claude-code").write("TOKEN", "https://memorify.dev/mcp");
    const cfg = JSON.parse(await readFile(file, "utf8"));
    assert.equal(cfg.mcpServers.other.command, "x");
    assert.equal(cfg.mcpServers.memorify.url, "https://memorify.dev/mcp");
    assert.equal(cfg.mcpServers.memorify.headers.Authorization, "Bearer TOKEN");
  });
});

test("an unparseable config is left untouched (no silent overwrite)", async () => {
  await inTempDir(async (dir) => {
    const original = '{ // user comment\n "mcpServers": { "keep": {} } }';
    await writeFile(path.join(dir, ".mcp.json"), original);
    await assert.rejects(() => getClient("claude-code").write("TOKEN", "https://memorify.dev/mcp"), /not valid JSON/);
    assert.equal(await readFile(path.join(dir, ".mcp.json"), "utf8"), original);
  });
});

test("first write keeps a one-time backup of the previous file", async () => {
  await inTempDir(async (dir) => {
    await writeFile(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { a: {} } }));
    await getClient("claude-code").write("T1", "https://memorify.dev/mcp");
    await getClient("claude-code").write("T2", "https://memorify.dev/mcp");
    const bak = JSON.parse(await readFile(path.join(dir, ".mcp.json.memorify.bak"), "utf8"));
    assert.deepEqual(Object.keys(bak.mcpServers), ["a"]);
  });
});

test("written config is owner-only where the platform supports modes", async () => {
  await inTempDir(async () => {
    const file = await getClient("claude-code").write("TOKEN", "https://memorify.dev/mcp");
    if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o077, 0);
  });
});

test("stdio bridge entry uses the scoped, version-pinned package, never a URL", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "memorify-cli-home-"));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA };
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  process.env.APPDATA = dir;
  try {
    const file = await getClient("claude-desktop").write("TOKEN", "https://memorify.dev/mcp");
    const entry = JSON.parse(await readFile(file, "utf8")).mcpServers.memorify;
    assert.equal(entry.command, "npx");
    assert.deepEqual(entry.args, ["-y", `${PACKAGE}@${VERSION}`, "mcp"]);
    assert.ok(!JSON.stringify(entry.args).includes("http"), "no URL tarball in the launch command");
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
