import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { repo } from "./harness";

const root = mkdtempSync(join(repo, ".tmp/desktop/window-persistent-"));
const client = join(root, "client-fixture");
mkdirSync(client);
const baseline = '# Persistent desktop window smoke\nmodel = "gpt-5.4"\n';
writeFileSync(join(client, "config.toml"), baseline);
const paths = [join(homedir(), ".codex/config.toml"), join(homedir(), ".opencodex/config.json")];
const fingerprint = () => paths.map(path => existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null);
const before = fingerprint();
for (const reopen of [false, true]) {
  const previousSessions = new Set(existsSync(join(root, "runs")) ? readdirSync(join(root, "runs")) : []);
  const args = [join(repo, "desktop/src-tauri/target/debug/opencodex-desktop.exe"), "--smoke-persistent", root];
  if (reopen) args.push("--smoke-reopen");
  const child = Bun.spawn(args, { cwd: repo, stdin: "ignore", stdout: "ignore", stderr: "ignore", windowsHide: true });
  const timer = setTimeout(() => child.kill(), 220000);
  try {
    const code = await child.exited;
    const session = readdirSync(join(root, "runs")).find(name => !previousSessions.has(name));
    if (!session) throw new Error("No test window session; exit any existing desktop instance first.");
    const result = JSON.parse(readFileSync(join(root, "runs", session, "smoke-result.json"), "utf8"));
    if (code !== 0 || !result.ok) throw new Error(`Persistent window failed: ${JSON.stringify(result)}`);
    if (readFileSync(join(client, "config.toml"), "utf8") !== baseline) throw new Error("Window exit did not restore the client baseline");
    if (existsSync(join(root, ".opencodex/runtime-port.json"))) throw new Error("Window exit left its runtime record");
    console.log(JSON.stringify({ ...result, reopen, nativeBaselineRestored: true }));
  } finally { clearTimeout(timer); }
}
if (JSON.stringify(before) !== JSON.stringify(fingerprint())) throw new Error("Real user configuration changed");
console.log(JSON.stringify({ ok: true, realConfigUnchanged: true, root }));
