import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** Reuse this desktop session on restart while retaining its preview-only boundaries. */
export function preparePreviewConfig(path: string, resumeCodex = false): { shutdownTimeoutMs: number } {
  const previous = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { providers: {}, defaultProvider: "openai" };
  if (!previous || typeof previous !== "object" || Array.isArray(previous)) {
    throw new Error("Invalid desktop session configuration; inspect the file before retrying.");
  }
  const configuredTimeout = previous.shutdownTimeoutMs;
  const shutdownTimeoutMs = typeof configuredTimeout === "number" && Number.isFinite(configuredTimeout)
    ? Math.max(0, Math.min(60000, configuredTimeout)) : 5000;
  const next = {
    ...previous,
    port: previous.port ?? 10100,
    hostname: "127.0.0.1",
    shutdownTimeoutMs,
    codexAutoStart: false,
    codexShimAutoRestore: false,
    clientIntegrations: { ...previous.clientIntegrations, codex: resumeCodex || previous.clientIntegrations?.codex === true, grok: false, "claude-desktop": false },
    claudeCode: { ...previous.claudeCode, enabled: false, systemEnv: false },
  };
  writeFileSync(path, JSON.stringify(next, null, 2));
  return { shutdownTimeoutMs };
}
