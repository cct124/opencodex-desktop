import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { isolatedEnvironment, persistentEnvironment, prepareDirectories } from "./environment";
import { ownedBackendReady } from "./readiness";
import { preparePreviewConfig } from "./profile";
import { RoutingGate, runRoutingCommand, type RoutingAction } from "./routing";
import { assertNativeAvailable, assertPreviousBackendStopped, DesktopConnectionError, importedSettings, ownsNativeRoute, readConnection, writePrivateJson } from "./persistent";

const repo = realpathSync(resolve(import.meta.dir, "../.."));
const session = realpathSync(process.argv[2] ?? "");
const option = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const persistent = process.argv.includes("--persistent");
const root = persistent ? realpathSync(option("--data-root") ?? "") : session;
const realHome = homedir();
const targetCodex = resolve(option("--codex-home") ?? process.env.CODEX_HOME ?? join(realHome, ".codex"));
const sourceConfig = resolve(option("--source-config") ?? join(process.env.OPENCODEX_HOME ?? join(realHome, ".opencodex"), "config.json"));
const resumeCodex = process.argv.includes("--resume-codex");
const sessionRelative = relative(join(repo, ".tmp", "desktop"), session);
if (!persistent && (!sessionRelative || sessionRelative.startsWith("..") || resolve(join(repo, ".tmp", "desktop"), sessionRelative) !== session)) {
  throw new Error("Desktop runtime requires a session inside this project's .tmp/desktop directory.");
}
const prefix = "OCX_DESKTOP_EVENT ";
function report(event: Record<string, unknown>): void {
  process.stdout.write(`${prefix}${JSON.stringify({ ...event, pid: process.pid })}\n`);
}

let connection = readConnection(root, targetCodex);
const attached = persistent && connection.authorized;
const saveConnection = () => writePrivateJson(join(root, "connection.json"), connection);
if (attached) {
  assertPreviousBackendStopped(connection);
  assertNativeAvailable(connection);
}
const env = persistent ? persistentEnvironment(root, realHome, process.env, attached ? targetCodex : undefined) : isolatedEnvironment(session, realHome, process.env);
prepareDirectories(env);
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, env);
process.env.OCX_BUN_RUNTIME_SOURCE = "bundled";
process.env.OCX_BUN_RUNTIME_PATH = process.execPath;

const configPath = join(env.OPENCODEX_HOME!, "config.json");
// Recovery runs with injection disabled, before the source CLI can recover any journal itself.
const { shutdownTimeoutMs } = preparePreviewConfig(configPath, persistent ? false : resumeCodex, persistent);
if (attached && connection.lease) {
  if (ownsNativeRoute(connection)) {
    const result = await runRoutingCommand(repo, "restore");
    if (!result.success || ownsNativeRoute(connection)) throw new Error("上次桌面代理的配置尚未恢复，请查看日志后重试。");
  }
  delete connection.lease;
  saveConnection();
}

const port = await new Promise<number>((accept, reject) => {
  const reservation = createServer();
  reservation.once("error", reject);
  reservation.listen(0, "127.0.0.1", () => {
    const address = reservation.address();
    if (!address || typeof address === "string") return reject(new Error("Cannot allocate a loopback port"));
    reservation.close(error => error ? reject(error) : accept(address.port));
  });
});
if (attached && connection.reconnect) {
  assertNativeAvailable(connection);
  connection.lease = { pid: process.pid, port };
  saveConnection();
  process.env.OPENCODEX_DESKTOP_SKIP_CODEX_RESTORE = "0";
  preparePreviewConfig(configPath, true, true);
}
report({ type: "profile", persistent, data_dir: root, codex_home: targetCodex, source_config: sourceConfig, attached });
// A concurrent bind is still possible. Upstream's explicit --port fails instead of attaching elsewhere.
process.argv = [process.execPath, join(repo, "src", "cli", "index.ts"), "start", "--port", String(port)];

let stopping = false;
let ready = false;
let shutdownAdmitted = false;
const routingGate = new RoutingGate();
let signalSent = false;
let cleanupFailed = false;
let stopTimer: ReturnType<typeof setTimeout> | undefined;
function deliverShutdown(): void {
  if (!shutdownAdmitted || signalSent || process.listenerCount("SIGINT") === 0) return;
  signalSent = true;
  process.emit("SIGINT");
}
function stop(disconnect = false): void {
  if (stopping) return;
  stopping = true;
  report({ type: "stopping" });
  void routingGate.close().finally(() => {
    if (persistent) {
      // Fail closed before reading potentially edited client files, but still drain the backend.
      process.env.OPENCODEX_DESKTOP_SKIP_CODEX_RESTORE = "1";
      try {
        if (disconnect) { connection.reconnect = false; saveConnection(); }
        if (attached && ownsNativeRoute(connection)) process.env.OPENCODEX_DESKTOP_SKIP_CODEX_RESTORE = "0";
      } catch {
        cleanupFailed = true;
        console.error("桌面连接记录或 Codex 配置无法确认，已保留原文件；请检查后再恢复。");
      }
    }
    // Finish admitted routing writes before upstream shutdown restores native state.
    shutdownAdmitted = true;
    deliverShutdown();
    stopTimer = setTimeout(() => process.exit(1), shutdownTimeoutMs + 15000);
  });
}
let lastRouting: string | undefined;
async function reportRouting(success?: boolean, message?: string): Promise<void> {
  const { getCodexRoutingKind } = await import("../../src/codex/inject");
  const routing = getCodexRoutingKind();
  if (routing !== lastRouting || success !== undefined) {
    lastRouting = routing;
    report({ type: "routing", routing, success, message });
  }
}
const routingTimer = setInterval(() => { if (ready && !stopping) void reportRouting().catch(() => {}); }, 1000);
routingTimer.unref();
function switchRouting(action: RoutingAction): void {
  if (!ready || stopping) return;
  routingGate.run(async () => {
    try {
      const runtime = JSON.parse(readFileSync(join(env.OPENCODEX_HOME!, "runtime-port.json"), "utf8"));
      if (runtime.pid !== process.pid || runtime.port !== port || !await ownedBackendReady(port, process.pid, runtime.attestationSecret)) {
        await reportRouting(false, "当前代理身份或就绪检查失败，未修改 Codex 配置。");
        return;
      }
      if (persistent && !attached) {
        if (action === "restore") { await reportRouting(true, "尚未接入真实 Codex，无需恢复。"); return; }
        assertNativeAvailable(connection);
        connection.authorized = true;
        connection.reconnect = true;
        saveConnection();
        report({ type: "reconfigure", message: "正在切换到真实 Codex，代理将重新启动一次…" });
        return;
      }
      if (attached) {
        assertNativeAvailable(connection);
        if (action === "restore-back") {
          connection.lease = { pid: process.pid, port };
          saveConnection();
          process.env.OPENCODEX_DESKTOP_SKIP_CODEX_RESTORE = "0";
        }
      }
      const result = await runRoutingCommand(repo, action);
      if (attached && result.success) {
        if (action === "restore-back" && !ownsNativeRoute(connection)) throw new Error("Codex 未连接到当前桌面代理。");
        connection.reconnect = action === "restore-back";
        if (!connection.reconnect) {
          delete connection.lease;
          process.env.OPENCODEX_DESKTOP_SKIP_CODEX_RESTORE = "1";
        }
        saveConnection();
      }
      await reportRouting(result.success, result.message);
    } catch (error) {
      console.error(error);
      report({ type: "routing", routing: "unknown", success: false, message: error instanceof DesktopConnectionError ? error.message : "Codex 切换失败，请查看后端日志。" });
    }
  });
}

function importConfiguration(raw: string | undefined): void {
  if (!ready || stopping) return;
  routingGate.run(async () => {
    try {
      const candidate = JSON.parse(raw ?? readFileSync(sourceConfig, "utf8"));
      const { loadConfig, validateConfigCandidate, saveConfig, hardenExistingSecret } = await import("../../src/config");
      const current = loadConfig();
      const validated = validateConfigCandidate(importedSettings(candidate, current));
      if (!validated.ok) throw new Error("配置校验未通过，请检查文件格式与提供方设置。");
      const backups = join(env.OPENCODEX_HOME!, "backups");
      mkdirSync(backups, { recursive: true });
      const backup = join(backups, `before-import-${Date.now()}.json`);
      writePrivateJson(backup, JSON.parse(readFileSync(configPath, "utf8")));
      hardenExistingSecret(backup);
      saveConfig(validated.config);
      report({ type: "reconfigure", message: "配置已导入，原桌面配置已备份；正在重启代理…" });
    } catch {
      report({ type: "routing", routing: lastRouting ?? "unknown", success: false, message: "导入失败：请选择有效的 OpenCodex 配置 JSON；原配置保留在数据目录中。" });
    }
  });
}
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  input += chunk;
  if (input.length > 4 * 1024 * 1024) return stop();
  while (input.includes("\n")) {
    const end = input.indexOf("\n");
    const command = input.slice(0, end).trim();
    input = input.slice(end + 1);
    if (command === "shutdown") stop();
    else if (command === "shutdown-disconnect") stop(true);
    else if (command === "restore" || command === "restore-back") switchRouting(command);
    else if (command === "import-existing") importConfiguration(undefined);
    else if (command.startsWith("{")) {
      try { const request = JSON.parse(command); if (request.type === "import-config" && typeof request.config === "string") importConfiguration(request.config); }
      catch { /* only fixed messages from the local desktop launcher are accepted */ }
    }
  }
});
process.stdin.on("end", () => stop());
process.stdin.on("error", () => stop());
process.on("exit", () => { if (stopTimer) clearTimeout(stopTimer); if (cleanupFailed) process.exitCode = 1; });
process.on("newListener", event => { if (event === "SIGINT" && stopping) queueMicrotask(deliverShutdown); });

const deadline = Date.now() + 60000;
async function awaitReady(): Promise<void> {
  while (!stopping && Date.now() < deadline) {
    try {
      const runtime = JSON.parse(readFileSync(join(env.OPENCODEX_HOME!, "runtime-port.json"), "utf8"));
      if (runtime.pid === process.pid && runtime.port === port && await ownedBackendReady(port, process.pid, runtime.attestationSecret)) {
        ready = true;
        report({ type: "ready", url: `http://127.0.0.1:${port}/` });
        await reportRouting();
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
