// Runs the compiled tests on every supported Node version (older `node --test` versions don't expand globs).
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const dir = new URL("./dist/test/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".test.js")).map((f) => new URL(f, dir).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
if (files.length === 0) {
  console.error("no compiled tests found in dist/test");
  process.exit(1);
}
const r = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
