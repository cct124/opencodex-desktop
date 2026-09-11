import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "../..");
const executable = join(repo, "desktop/src-tauri/target/debug/opencodex-desktop.exe");
const protectedPaths = [join(homedir(), ".opencodex/config.json"), join(homedir(), ".codex/config.toml")];
const fingerprints = () => protectedPaths.map(path => existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null);
const before = fingerprints();
const sessions = join(repo, ".tmp/desktop");
const previousSessions = new Set(existsSync(sessions) ? readdirSync(sessions) : []);
const mode = process.argv.includes("--startup-stop") ? "--smoke-startup-stop" : "--smoke-lifecycle";
const child = Bun.spawn([executable, mode], { cwd: repo, stdin: "ignore", stdout: "ignore", stderr: "ignore", windowsHide: true });
const timer = setTimeout(() => child.kill(), 360000);
try {
  const code = await child.exited;
  const name = readdirSync(sessions).find(name => !previousSessions.has(name) && name.startsWith(`session-${child.pid}-`));
  if (!name) throw new Error("No new desktop session: close the existing development instance before running smoke checks.");
  const session = join(sessions, name);
  const report = JSON.parse(readFileSync(join(session, "smoke-result.json"), "utf8"));
  const status = JSON.parse(readFileSync(join(session, "desktop-status.json"), "utf8"));
  if (code !== 0 || !report.ok) throw new Error(`Native lifecycle failed: ${JSON.stringify({ code, report, session })}`);
  if (status.backend_pid !== null || status.phase !== "exiting") throw new Error("Application exit did not await backend cleanup");
  if (existsSync(join(session, ".opencodex/runtime-port.json"))) throw new Error("Runtime record remained after quit");
  if (JSON.stringify(fingerprints()) !== JSON.stringify(before)) throw new Error("Real user configuration changed");
  console.log(JSON.stringify({ ...report, exitCode: code, realConfigUnchanged: true, ownBackendCleanedUp: true, session }));
} finally { clearTimeout(timer); }
