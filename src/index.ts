#!/usr/bin/env node
// src/index.ts — `memorify` CLI: universal MCP onboarding for any AI client.
//
//   memorify pair                    detect clients, pair, write configs
//   memorify pair --client cursor    write config for one specific client
//   memorify pair --print            print token to stdout instead of configs
//   memorify mcp                     stdio⇄HTTP bridge (for Claude Desktop)
//   memorify whoami                  verify a stored/printed token

import { spawn } from "node:child_process";
import { startPairing, pollUntilApproved, cancelPairing, PairingDenied, PairingRateLimited, formatWait } from "./pair.js";
import { CLIENTS, getClient, saveCredentials, loadToken, guardProjectSecret, type ClientTarget } from "./clients.js";
import { runBridge } from "./bridge.js";
import { assertSecureUrl, browserCommand, resolveHost } from "./safety.js";
import { VERSION } from "./version.js";

const log = (m = "") => process.stderr.write(m + "\n"); // keep stdout clean for --print

interface Args {
  _: string[];
  [k: string]: string | boolean | string[] | undefined;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function openBrowser(url: string): void {
  try {
    const { cmd, args } = browserCommand(process.platform, url); // no shell: hostile URLs cannot inject commands
    spawn(cmd, args, { stdio: "ignore", detached: true, shell: false }).unref();
  } catch {
    /* user can open the printed URL manually */
  }
}


async function cmdPair(args: Args): Promise<void> {
  const host = resolveHost(args.host as string | undefined, args["allow-custom-host"] === true);
  const name = (args.name as string) || "memorify-cli";
  const printOnly = args.print === true;
  const clientIds = args.client ? String(args.client).split(",") : null;

  // Resolve which clients to configure before starting the flow.
  let targets: ClientTarget[] = [];
  if (!printOnly) {
    if (clientIds) {
      targets = clientIds.map((id) => getClient(id.trim()));
    } else {
      log("Detecting installed MCP clients…");
      const detected: ClientTarget[] = [];
      for (const c of CLIENTS) {
        if (await c.detect()) {
          detected.push(c);
          log(`  + ${c.label}`);
        }
      }
      if (detected.length === 0) {
        log("  (none detected — pass --client <id> explicitly; see `memorify clients`)");
        log("  falling back to project .mcp.json (Claude Code / Cline / Roo Code format)");
        detected.push(getClient("claude-code"));
      }
      if (detected.length > 1) {
        log(`Multiple clients detected — configuring all ${detected.length}.`);
      }
      targets = detected;
    }
  }

  log(`\nRequesting pairing code from ${host}…`);
  const loginHint = typeof args.email === "string" ? args.email : process.env.MEMORIFY_EMAIL;
  let start;
  for (let attempt = 0; ; attempt++) {
    try {
      start = await startPairing(host, name, "cli", undefined, loginHint);
      break;
    } catch (e) {
      if (!(e instanceof PairingRateLimited)) throw e;
      log(`\n[WAIT] ${e.message}`);
      // --wait: keep the terminal open and retry automatically once the pause is over (at most twice).
      if (args.wait !== true || attempt >= 2) process.exit(2);
      await countdown(e.retryAfterSeconds);
    }
  }
  log("");
  log("  +-----------------------------------------+");
  log(`  |  Your code:  ${start.user_code.padEnd(28)}|`);
  log("  +-----------------------------------------+");
  log(`  Open ${start.verification_uri} and approve the agent.\n`);
  if (args["no-open"] !== true) openBrowser(start.verification_uri);

  let token: string;
  let mcpUrl: string;
  try {
    const result = await pollUntilApproved(host, start.device_code, start, (m) => log(`  ... ${m}`));
    token = result.access_token;
    mcpUrl = result.mcp_url;
  } catch (e) {
    if (e instanceof PairingDenied) {
      await cancelPairing(host, start.device_code);
      log(`\n[FAIL] ${e.message}`);
      process.exit(1);
    }
    throw e;
  }

  log("\nPaired! Token received.");
  const credFile = await saveCredentials(token);
  log(`  - Token saved to ${credFile}`);

  if (printOnly) {
    process.stdout.write(token + "\n");
    return;
  }

  for (const t of targets) {
    const file = await t.write(token, mcpUrl);
    const guarded = await guardProjectSecret(file);
    const mode = t.stdioOnly ? "stdio bridge" : "native HTTP";
    log(`  - Configured ${t.label} [${mode}] -> ${file}${guarded ? " (git-excluded — contains your live token, do not commit)" : ""}`);
  }
  log(`\nDone. Restart your client and the "memorify" MCP server will be available.`);
  log("(Keep your token secret — revoke anytime at memorify.dev/dashboard/agents)");
}

async function cmdMcp(args: Args): Promise<void> {
  const base = resolveHost(args.host as string | undefined, args["allow-custom-host"] === true);
  const url = assertSecureUrl((args.url as string) || `${base}/mcp`, "--url").toString();
  // Tokens come from the environment or the credentials file only: a --token flag is visible in process listings.
  const token = process.env.MEMORIFY_TOKEN || (await loadToken());
  if (!token) {
    log("No token. Run `memorify pair` first, or set MEMORIFY_TOKEN.");
    process.exit(1);
  }
  runBridge(url, token);
}

async function cmdWhoami(args: Args): Promise<void> {
  const host = resolveHost(args.host as string | undefined, args["allow-custom-host"] === true);
  const token = process.env.MEMORIFY_TOKEN || (await loadToken());
  if (!token) {
    log("No token. Run `memorify pair` first.");
    process.exit(1);
  }
  const res = await fetch(`${host}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: {} } }),
  });
  const text = await res.text();
  if (!res.ok) {
    log(`[FAIL] ${res.status} ${text.slice(0, 200)}`);
    process.exit(1);
  }
  log(text);
}

function cmdClients(): void {
  log("Supported MCP clients:");
  for (const c of CLIENTS) {
    log(`  ${c.id.padEnd(16)} ${c.label}${c.stdioOnly ? "  [stdio bridge — handled automatically]" : ""}`);
  }
}

/** Live countdown on a terminal, one line per 30 s when not interactive. */
async function countdown(seconds: number): Promise<void> {
  const end = Date.now() + seconds * 1000;
  const tty = Boolean(process.stdout.isTTY);
  while (Date.now() < end) {
    const left = Math.ceil((end - Date.now()) / 1000);
    if (tty) process.stdout.write(`\r  retrying in ${formatWait(left)}…      `);
    else if (left % 30 === 0) log(`  retrying in ${formatWait(left)}…`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (tty) process.stdout.write("\r" + " ".repeat(40) + "\r");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  try {
    if (cmd === "pair") await cmdPair(args);
    else if (cmd === "mcp") await cmdMcp(args);
    else if (cmd === "whoami") await cmdWhoami(args);
    else if (cmd === "clients") cmdClients();
    else {
      log(`memorify — universal MCP onboarding (v${VERSION})`);
      log("");
      log("  memorify pair [--client <id|id,id>] [--print] [--name <n>] [--no-open] [--email <you@x.com>] [--wait]");
      log("      Run the device-flow pairing and write MCP config for detected clients.");
      log("      --email  also email you about the request (or set MEMORIFY_EMAIL).");
      log("      --wait   if pairing is paused for this computer, wait and retry automatically.");
      log("  memorify mcp [--url <u>]   (token from MEMORIFY_TOKEN or ~/.memorify/credentials.json)");
      log("      stdio<->HTTP bridge — lets stdio-only clients (Claude Desktop) connect.");
      log("  memorify whoami");
      log("      Verify the current token against the live server.");
      log("  memorify clients");
      log("      List supported clients.");
    }
  } catch (e: any) {
    log(`[FAIL] ${e.message}`);
    process.exit(1);
  }
}

main();
