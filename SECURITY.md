# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private vulnerability reporting
("Security" tab → "Report a vulnerability") on this repository.

Include: affected version, what you found, and steps to reproduce. You can expect an acknowledgement within
a few days. Please give us reasonable time to fix before disclosing.

## Scope

- This CLI (`@hlsitech/memorify`): pairing flow, config writing, the stdio bridge.
- The hosted service at memorify.dev is out of scope for this repository's issue tracker — report it privately
  through the same channel and we will route it.

## Design notes

See "Security model" in the README. Notable rules: HTTPS only, same-origin server URLs, no shell for the browser
launch, owner-only config files, no token on the command line, scoped and versioned package name.
