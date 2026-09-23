import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { hasRestoredProcessJournal } from "./restored-journal";

/** Only these fixed messages may be shown by native controls without log details. */
export class DesktopConnectionError extends Error {}

export interface ConnectionState {
  version: 1;
  authorized: boolean;
  reconnect: boolean;
  codexHome: string;
  listenPort?: number;
  lease?: { pid: number; port: number };
}

export function writePrivateJson(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(temporary, path);
}

export function readConnection(root: string, codexHome: string): ConnectionState {
  const path = join(root, "connection.json");
  if (!existsSync(path)) return { version: 1, authorized: false, reconnect: false, codexHome };
  const state = JSON.parse(readFileSync(path, "utf8")) as ConnectionState;
  if (state.version !== 1 || typeof state.authorized !== "boolean" || typeof state.reconnect !== "boolean"
      || resolve(state.codexHome).toLowerCase() !== resolve(codexHome).toLowerCase()
      || (state.reconnect && !state.authorized)
      || (state.listenPort !== undefined && (!Number.isInteger(state.listenPort) || state.listenPort < 1 || state.listenPort > 65535))
      || (state.lease && (!state.authorized || !Number.isInteger(state.lease.pid) || state.lease.pid <= 0
        || !Number.isInteger(state.lease.port) || state.lease.port < 1 || state.lease.port > 65535))) {
    throw new DesktopConnectionError("桌面连接记录无效或 Codex 目录已改变，请检查 connection.json；原文件已保留。");
  }
  return state;
}

function nativeConfig(codexHome: string): Record<string, unknown> {
  const path = join(codexHome, "config.toml");
  if (!existsSync(path)) return {};
  if (!statSync(path).isFile()) throw new DesktopConnectionError("Codex 配置不是普通文件。");
  try { return Bun.TOML.parse(readFileSync(path, "utf8")) as Record<string, unknown>; }
  catch { throw new DesktopConnectionError("Codex 配置无法解析，未修改该文件。"); }
}

/** A desktop lease must agree with the actual endpoint, never just a marker comment. */
export function ownsNativeRoute(state: ConnectionState): boolean {
  if (!state.lease) return false;
  const config = nativeConfig(state.codexHome);
  const endpoint = `http://127.0.0.1:${state.lease.port}`;
  return config.openai_base_url === endpoint || config.openai_base_url === `${endpoint}/v1`;
}

/** Refuse active/ambiguous ownership; an already-restored process journal is not a route. */
export function assertNativeAvailable(state: ConnectionState): void {
  if (ownsNativeRoute(state)) return;
  const config = nativeConfig(state.codexHome);
  if (config.openai_base_url || (config.model_provider && config.model_provider !== "openai")) {
    throw new DesktopConnectionError("Codex 当前由其他配置或代理接管。请先在原工具中恢复原生 Codex，再连接桌面版。");
  }
  if (existsSync(join(state.codexHome, "opencodex-journal.json"))
      && !hasRestoredProcessJournal(state.codexHome, state.authorized)) {
    throw new DesktopConnectionError("Codex 恢复记录尚未完成或无法确认归属，未修改原文件。请在原工具中完成恢复后重试，或检查 Codex 恢复记录。");
  }
}

export function assertPreviousBackendStopped(state: ConnectionState): void {
  if (!state.lease || state.lease.pid === process.pid) return;
  try { process.kill(state.lease.pid, 0); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    throw new DesktopConnectionError("无法确认上次桌面后端已退出，未接管 Codex。");
  }
  throw new DesktopConnectionError("上次桌面后端仍在运行，请先退出原实例。");
}

/** Import product settings, keeping desktop-owned lifecycle and client intent local. */
export function importedSettings(candidate: unknown, current: Record<string, any>): Record<string, any> {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("请选择 OpenCodex 的配置 JSON 文件。");
  const source = candidate as Record<string, any>;
  // Account vaults, PID records, service definitions and native journals are never imported.
  return {
    ...source,
    port: current.port,
    hostname: "127.0.0.1",
    runtimeRole: "standalone",
    unauthenticatedLoopbackListener: undefined,
    codexAutoStart: false,
    codexShimAutoRestore: false,
    clientIntegrations: current.clientIntegrations,
    claudeCode: { ...source.claudeCode, enabled: false, systemEnv: false },
    syncResumeHistory: false,
  };
}
