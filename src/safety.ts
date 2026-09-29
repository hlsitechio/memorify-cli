// src/safety.ts — small, dependency-free guards used by the CLI. Kept pure so they can be unit tested.

export const OFFICIAL_HOST = "https://memorify.dev";

/** Parse and require https (http only for localhost development). Throws on anything else. */
export function assertSecureUrl(raw: string, label: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`${label}: not a valid URL`);
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) {
    throw new Error(`${label}: must be https (got ${u.protocol})`);
  }
  if (u.username || u.password) throw new Error(`${label}: credentials in URL are not allowed`);
  return u;
}

/** The pairing host. Custom hosts need an explicit opt-in because they receive your token. */
export function resolveHost(input: string | undefined, allowCustom: boolean): string {
  const host = (input ?? OFFICIAL_HOST).replace(/\/+$/, "");
  const u = assertSecureUrl(host, "--host");
  if (u.origin !== new URL(OFFICIAL_HOST).origin && !allowCustom) {
    throw new Error(
      `--host ${u.origin} is not the official Memorify host. Pass --allow-custom-host only if you run your own server: it will receive your token.`,
    );
  }
  return u.origin;
}

/** A URL returned by the server must stay on the origin we are talking to. */
export function assertSameOrigin(candidate: string, host: string, label: string): string {
  const u = assertSecureUrl(candidate, label);
  if (u.origin !== new URL(host).origin) {
    throw new Error(`${label}: ${u.origin} does not match the pairing host ${new URL(host).origin}`);
  }
  return u.toString();
}

/**
 * Command + args to open a URL in the default browser WITHOUT going through a shell that interprets
 * metacharacters (the old `cmd /c start "" <url>` would run `&calc` from a hostile URL).
 */
export function browserCommand(platform: string, url: string): { cmd: string; args: string[] } {
  const u = assertSecureUrl(url, "verification_uri").toString();
  if (platform === "win32") return { cmd: "rundll32", args: ["url.dll,FileProtocolHandler", u] };
  if (platform === "darwin") return { cmd: "open", args: [u] };
  return { cmd: "xdg-open", args: [u] };
}

/** Parse JSON config strictly: an unreadable config must never be silently replaced by `{}`. */
export function parseConfigStrict(text: string, file: string): any {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `${file} is not valid JSON (comments or a syntax error?). Not modifying it — add the "memorify" server by hand or fix the file and re-run.`,
    );
  }
}
