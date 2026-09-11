import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { isolatedEnvironment, prepareDirectories } from "./environment";
import { ownedBackendReady } from "./readiness";

const repo = realpathSync(resolve(import.meta.dir, "../.."));
const session = realpathSync(process.argv[2] ?? "");
const sessionRelative = relative(join(repo, ".tmp", "desktop"), session);
if (!sessionRelative || sessionRelative.startsWith("..") || resolve(join(repo, ".tmp", "desktop"), sessionRelative) !== session) {
  throw new Error("Desktop runtime requires a new session inside this project's .tmp/desktop directory.");
}
const prefix = "OCX_DESKTOP_EVENT ";
function report(event: Record<string, unknown>): void {
  process.stdout.write(`${prefix}${JSON.stringify({ ...event, pid: process.pid })}\n`);
}

const env = isolatedEnvironment(session, homedir(), process.env);
prepareDirectories(env);
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, env);
process.env.OCX_BUN_RUNTIME_SOURCE = "bundled";
process.env.OCX_BUN_RUNTIME_PATH = process.execPath;

const configPath = join(env.OPENCODEX_HOME!, "config.json");
if (existsSync(configPath)) throw new Error("Desktop preview requires a fresh session profile.");
writeFileSync(configPath, JSON.stringify({
  port: 10100,
  hostname: "127.0.0.1",
  providers: {},
  defaultProvider: "openai",
  codexAutoStart: false,
  codexShimAutoRestore: false,
  clientIntegrations: { codex: false, grok: false, "claude-desktop": false },
  claudeCode: { enabled: false, systemEnv: false },
}), { flag: "wx" });

const port = await new Promise<number>((accept, reject) => {
  const reservation = createServer();
  reservation.once("error", reject);
  reservation.listen(0, "127.0.0.1", () => {
    const address = reservation.address();
    if (!address || typeof address === "string") return reject(new Error("Cannot allocate a loopback port"));
    reservation.close(error => error ? reject(error) : accept(address.port));
  });
});
// A concurrent bind is still possible. Upstream's explicit --port fails instead of attaching elsewhere.
process.argv = [process.execPath, join(repo, "src", "cli", "index.ts"), "start", "--port", String(port)];

let stopping = false;
let signalSent = false;
let stopTimer: ReturnType<typeof setTimeout> | undefined;
function deliverShutdown(): void {
  if (!stopping || signalSent || process.listenerCount("SIGINT") === 0) return;
  signalSent = true;
  process.emit("SIGINT");
}
function stop(): void {
  if (stopping) return;
  stopping = true;
  report({ type: "stopping" });
  // Windows termination does not reliably dispatch POSIX signals. Invoke the CLI's actual handler in-process.
  deliverShutdown();
  stopTimer = setTimeout(() => process.exit(1), 12000);
}
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  input += chunk;
  if (input.length > 1024) return stop();
  if (input.includes("\n")) {
    if (input.trim() === "shutdown") stop();
    input = "";
  }
});
process.stdin.on("end", stop);
process.stdin.on("error", stop);
process.on("exit", () => { if (stopTimer) clearTimeout(stopTimer); });
process.on("newListener", event => { if (event === "SIGINT" && stopping) queueMicrotask(deliverShutdown); });

const deadline = Date.now() + 60000;
async function awaitReady(): Promise<void> {
  while (!stopping && Date.now() < deadline) {
    try {
      const runtime = JSON.parse(readFileSync(join(env.OPENCODEX_HOME!, "runtime-port.json"), "utf8"));
      if (runtime.pid === process.pid && runtime.port === port && await ownedBackendReady(port, process.pid, runtime.attestationSecret)) {
        report({ type: "ready", url: `http://127.0.0.1:${port}/` });
        return;
      }
    } catch { /* runtime record and listener are created during CLI startup */ }
    await Bun.sleep(200);
  }
  if (!stopping) {
    report({ type: "error", message: "后端在 60 秒内未就绪，请查看启动日志。" });
    stop();
  }
}
void awaitReady();
try {
  await import("../../src/cli/index");
} catch (error) {
  console.error(error);
  report({ type: "error", message: "后端启动失败，请查看启动日志。" });
  stop();
}
