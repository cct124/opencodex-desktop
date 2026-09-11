import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "../..");
const sessions = join(repo, ".tmp", "desktop");
mkdirSync(sessions, { recursive: true });
const session = mkdtempSync(join(sessions, "smoke-"));
const protectedPaths = [join(homedir(), ".opencodex", "config.json"), join(homedir(), ".codex", "config.toml")];
const fingerprint = (path: string) => existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null;
const before = protectedPaths.map(fingerprint);
// This listener belongs to the test, not to any existing user service.
const occupied = process.argv.includes("--occupied-port") ? Bun.serve({
  hostname: "127.0.0.1", port: 10100, fetch: () => new Response("desktop-port-owner"),
}) : undefined;
const child = Bun.spawn([process.execPath, join(repo, "desktop/runtime/entry.ts"), session], {
  cwd: repo, stdin: "pipe", stdout: "pipe", stderr: Bun.file(join(session, "stderr.log")), windowsHide: true,
});
const reader = child.stdout.getReader();
const decoder = new TextDecoder();
let pending = "";
let dashboard: string | undefined;
const timer = setTimeout(() => { child.kill(); }, 80000);
try {
  while (!dashboard) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`Backend exited before ready. Logs: ${session}`);
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith("OCX_DESKTOP_EVENT ")) continue;
      const event = JSON.parse(line.slice("OCX_DESKTOP_EVENT ".length));
      if (event.type === "error") throw new Error(event.message);
      if (event.type === "ready" && event.pid === child.pid) dashboard = event.url;
    }
  }
  const response = await fetch(dashboard!, { signal: AbortSignal.timeout(3000) });
  if (occupied && new URL(dashboard!).port === String(occupied.port)) throw new Error("Backend attached to the occupied default port");
  const html = await response.text();
  if (!response.ok || !html.includes('<div id="root">')) throw new Error("Original GUI did not load");
  // Continue consuming output so a full pipe cannot prevent graceful shutdown.
  void (async () => { while (!(await reader.read()).done) {} })();
  if (process.argv.includes("--parent-eof")) child.stdin.end();
  else { child.stdin.write("shutdown\n"); await child.stdin.flush(); }
  const code = await child.exited;
  if (code !== 0) throw new Error(`Backend shutdown returned ${code}; logs: ${session}`);
  if (existsSync(join(session, ".opencodex", "runtime-port.json"))) throw new Error("Owned runtime record was not cleaned up");
  if (JSON.stringify(before) !== JSON.stringify(protectedPaths.map(fingerprint))) throw new Error("Real client configuration changed");
  if (occupied && await (await fetch(`http://127.0.0.1:${occupied.port}`, { signal: AbortSignal.timeout(3000) })).text() !== "desktop-port-owner") throw new Error("Other port owner was affected by shutdown");
  console.log(JSON.stringify({ ok: true, entry: "project Bun + source CLI", gui: response.status, gracefulExit: code, parentEof: process.argv.includes("--parent-eof"), occupiedPortUnaffected: !!occupied, realConfigUnchanged: true, session }));
} finally {
  clearTimeout(timer);
  if (child.exitCode === null) { child.stdin.end(); await Promise.race([child.exited, Bun.sleep(15000)]); if (child.exitCode === null) child.kill(); }
  await occupied?.stop(true);
}
