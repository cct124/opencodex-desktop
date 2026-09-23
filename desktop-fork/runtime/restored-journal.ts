import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

function readOrdinaryFile(path: string): string | null {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Not an ordinary file");
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function decodeSnapshot(value: unknown): string {
  if (typeof value !== "string") throw new Error("Missing snapshot");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new Error("Invalid snapshot");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function nativeConfig(raw: string): Record<string, any> {
  const config = Bun.TOML.parse(raw) as Record<string, any>;
  if (config.openai_base_url !== undefined || config.experimental_realtime_ws_base_url !== undefined
      || (config.model_provider !== undefined && config.model_provider !== "openai")
      || config.profile !== undefined || config.model_providers?.openai !== undefined) {
    throw new Error("Routing is not demonstrably native");
  }
  return config;
}

/**
 * Restore can strip owned fields while preserving edits made by the Codex app.
 * In that case the upstream journal intentionally survives because the config
 * no longer equals the original snapshot. Its existence alone is not a route.
 *
 * This check is read-only: the next normal injection snapshots CURRENT native
 * settings through the upstream journal/write coordinator. Never replay or
 * delete an old snapshot here, and never admit a live foreign or client owner.
 */
export function hasRestoredProcessJournal(codexHome: string, allowCurrentProcess: boolean): boolean {
  try {
    const raw = readOrdinaryFile(join(codexHome, "opencodex-journal.json"));
    if (raw === null) return false;
    const journal = JSON.parse(raw);
    const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
    if (journal?.version !== 1 || !Number.isSafeInteger(journal.pid) || journal.pid <= 0
        || journal.owner?.kind !== "process" || journal.owner.pid !== journal.pid
        || !hash(journal.injectedConfigHash)
        || !(journal.injectedProfileHash === null || hash(journal.injectedProfileHash))) return false;

    const endpoint = new URL(journal.injectedOpenaiBaseUrl);
    if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port
        || endpoint.pathname !== "/v1" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return false;

    if (!(allowCurrentProcess && journal.pid === process.pid)) {
      try { process.kill(journal.pid, 0); return false; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false; }
    }

    nativeConfig(decodeSnapshot(journal.originalConfig));
    const current = readOrdinaryFile(join(codexHome, "config.toml"));
    if (current === null) return false;
    const config = nativeConfig(current);
    // An unresolved catalog pointer can still select proxy-routed models.
    if (typeof config.model_catalog_json === "string" && typeof journal.injectedCatalogPath === "string") {
      const canonical = (path: string) => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
      if (canonical(config.model_catalog_json) === canonical(journal.injectedCatalogPath)) return false;
    }
    const originalProfile = journal.originalProfile === null ? null : decodeSnapshot(journal.originalProfile);
    return readOrdinaryFile(join(codexHome, "opencodex.config.toml")) === originalProfile;
  } catch { return false; }
}
