# @hlsitech/memorify

Pair AI coding clients (Claude Code, Cursor, Windsurf, VS Code, Codex, Gemini CLI, …) with a
[Memorify](https://memorify.dev) MCP gateway using a **device-code flow**: you approve the agent in your
browser, so no secret is ever typed or pasted into a chat.

```bash
npx @hlsitech/memorify pair
```

> The package name matters. The unscoped `memorify` package on npm belongs to an unrelated third party —
> always use `@hlsitech/memorify`.

## What it does

1. Detects installed MCP clients (or use `--client cursor,claude-code`).
2. Requests a pairing code from `https://memorify.dev`, opens the approval page, and waits for you to approve.
3. Writes the MCP server entry into each client's config (owner-only permissions, previous file backed up once
   as `<file>.memorify.bak`). An unparseable config is never overwritten.

### Approving, waiting and alerts

- The approval page asks you to type the code shown in your terminal; nobody can approve a request without it.
- `--email you@example.com` (or `MEMORIFY_EMAIL`) also lets Memorify email you about the request. You also see it under the bell icon in the dashboard.
- Codes last 10 minutes. After repeated denied, expired or failed requests, Memorify pauses pairing for that computer with
  growing waits. The CLI tells you how long; add `--wait` to have it wait and retry
  automatically. Already-paired agents are never affected.

Other commands: `memorify whoami`, `memorify clients`, `memorify mcp` (a stdio⇄HTTP bridge for stdio-only
clients such as Claude Desktop).

## Prefer no token at all?

Clients that support OAuth for remote MCP servers don't need this CLI:

```bash
claude mcp add --transport http memorify https://memorify.dev/mcp
# then run /mcp in Claude Code and choose Authenticate
```

## Security model

- Tokens are **scoped, read-only by default, short-lived, and revocable** from your dashboard.
- The CLI only talks to `https://memorify.dev`. A custom `--host` requires `--allow-custom-host` because that
  server would receive your token. Every URL returned by the server must be `https` and on the same origin.
- The browser is opened without a shell, so a hostile URL cannot inject commands.
- Tokens are read from `MEMORIFY_TOKEN` or `~/.memorify/credentials.json` (mode 600) — there is no `--token`
  flag, because command-line arguments are visible to other processes.
- Releases are published from GitHub Actions with npm provenance, so you can verify the package was built from
  this repository.

Config files written by this tool contain a live token. Don't commit them (the CLI adds project-local files to
`.git/info/exclude` when it can).

## Reporting vulnerabilities

See [SECURITY.md](SECURITY.md).

## License

MIT. The hosted Memorify service is proprietary; only this CLI is open source.
