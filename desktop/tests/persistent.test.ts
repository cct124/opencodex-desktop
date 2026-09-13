import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertNativeAvailable, assertPreviousBackendStopped, DesktopConnectionError, importedSettings, ownsNativeRoute, readConnection, writePrivateJson } from "../runtime/persistent";
import { persistentEnvironment } from "../runtime/environment";
import { preparePreviewConfig } from "../runtime/profile";

const departed = Bun.spawn([process.execPath, "-e", ""], { stdout: "ignore", stderr: "ignore", windowsHide: true });
await departed.exited;
const originalNative = 'model = "gpt-5.4"\n';
function restoredJournal(codex: string) {
  const journal = {
    version: 1, pid: departed.pid, owner: { kind: "process", pid: departed.pid },
    timestamp: new Date().toISOString(),
    originalConfig: Buffer.from(originalNative).toString("base64"), originalProfile: null as string | null,
    injectedConfigHash: "a".repeat(64), injectedProfileHash: "b".repeat(64),
    injectedOpenaiBaseUrl: "http://127.0.0.1:13415/v1", injectedCatalogPath: join(codex, "opencodex-models.json"),
  };
  writeFileSync(join(codex, "config.toml"), 'service_tier = "fast"\n' + originalNative);
  writePrivateJson(join(codex, "opencodex-journal.json"), journal);
  return journal;
}

function fixture(run: (root: string, codex: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "ocx-persistent-"));
  const codex = join(root, "native-client");
  mkdirSync(codex);
  try { run(root, codex); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("connection choice survives application restarts and never defaults to authorized", () => fixture((root, codex) => {
  const state = readConnection(root, codex);
  expect(state.authorized).toBe(false);
  expect(state.reconnect).toBe(false);
  state.authorized = state.reconnect = true;
  writePrivateJson(join(root, "connection.json"), state);
  expect(readConnection(root, codex)).toEqual(state);
  expect(() => readConnection(root, join(root, "another-client"))).toThrow();
  writeFileSync(join(root, "connection.json"), "{broken");
  expect(() => readConnection(root, codex)).toThrow();
  expect(readFileSync(join(root, "connection.json"), "utf8")).toBe("{broken");
}));

test("foreign routes and journals are preserved; ownership needs a matching saved endpoint", () => fixture((root, codex) => {
  const state = readConnection(root, codex);
  const config = join(codex, "config.toml");
  writeFileSync(config, 'model = "gpt-5.4"\n');
  expect(() => assertNativeAvailable(state)).not.toThrow();
  writeFileSync(config, 'openai_base_url = "http://127.0.0.1:12345/v1"\n');
  expect(() => assertNativeAvailable(state)).toThrow(DesktopConnectionError);
  state.lease = { pid: process.pid, port: 12345 };
  expect(ownsNativeRoute(state)).toBe(true);
  expect(() => assertNativeAvailable(state)).not.toThrow();
  state.lease.port = 12346;
  expect(ownsNativeRoute(state)).toBe(false);
  expect(() => assertNativeAvailable(state)).toThrow();
  writeFileSync(config, 'model = "gpt-5.4"\n');
  writeFileSync(join(codex, "opencodex-journal.json"), "{}");
  expect(() => assertNativeAvailable(state)).toThrow();
  expect(readFileSync(join(codex, "opencodex-journal.json"), "utf8")).toBe("{}");
}));

test("a live previous backend cannot be adopted by another process", () => fixture((root, codex) => {
  const state = readConnection(root, codex);
  state.lease = { pid: process.ppid, port: 12345 };
  expect(() => assertPreviousBackendStopped(state)).toThrow();
}));

test("reinstallation admits an already-restored journal without replaying or deleting user settings", () => fixture((root, codex) => {
  restoredJournal(codex);
  const state = readConnection(root, codex); // New app data has no previous lease or consent.
  const configPath = join(codex, "config.toml");
  const journalPath = join(codex, "opencodex-journal.json");
  const beforeConfig = readFileSync(configPath, "utf8");
  const beforeJournal = readFileSync(journalPath, "utf8");
  expect(state.authorized).toBe(false);
  expect(() => assertNativeAvailable(state)).not.toThrow();
  expect(readFileSync(configPath, "utf8")).toBe(beforeConfig);
  expect(readFileSync(journalPath, "utf8")).toBe(beforeJournal);
  expect(state.authorized).toBe(false);
}));

test("a restored journal owned by this authorized backend permits same-process reconnection", () => fixture((root, codex) => {
  const journal = restoredJournal(codex);
  journal.pid = journal.owner.pid = process.pid;
  writePrivateJson(join(codex, "opencodex-journal.json"), journal);
  const state = readConnection(root, codex);
  expect(() => assertNativeAvailable(state)).toThrow();
  state.authorized = true;
  expect(() => assertNativeAvailable(state)).not.toThrow();
}));

test("native settings do not bypass live, client-owned, malformed or unverified journals", () => fixture((root, codex) => {
  const baseline = restoredJournal(codex);
  const state = readConnection(root, codex);
  state.authorized = true;
  for (const change of [
    { pid: process.ppid, owner: { kind: "process", pid: process.ppid } },
    { owner: { kind: "client", apiKeyId: "fixture-client" } },
    { owner: { kind: "process", pid: baseline.pid + 1 } },
    { owner: undefined }, { version: 2 }, { pid: -1 },
    { injectedConfigHash: undefined }, { injectedProfileHash: undefined },
    { originalConfig: "not-base64!" }, { originalProfile: undefined },
    { injectedOpenaiBaseUrl: "https://example.invalid/v1" },
    { originalConfig: Buffer.from('model_provider = "another-proxy"').toString("base64") },
  ]) {
    const candidate = JSON.stringify({ ...baseline, ...change });
    writeFileSync(join(codex, "opencodex-journal.json"), candidate);
    expect(() => assertNativeAvailable(state)).toThrow(DesktopConnectionError);
    expect(readFileSync(join(codex, "opencodex-journal.json"), "utf8")).toBe(candidate);
  }
}));

test("unrestored profiles and HTTP, realtime, profile or catalog overrides remain blocked", () => fixture((root, codex) => {
  const journal = restoredJournal(codex);
  const state = readConnection(root, codex);
  for (const route of [
    'openai_base_url = "http://127.0.0.1:13415/v1"',
    'experimental_realtime_ws_base_url = "http://127.0.0.1:13415/v1"',
    'model_provider = "other"', 'profile = "custom"',
    `[model_providers.openai]\nbase_url = "http://127.0.0.1:13415/v1"`,
    `model_catalog_json = ${JSON.stringify(journal.injectedCatalogPath)}`,
    'model = "unterminated',
  ]) {
    writeFileSync(join(codex, "config.toml"), route);
    expect(() => assertNativeAvailable(state)).toThrow();
    expect(readFileSync(join(codex, "config.toml"), "utf8")).toBe(route);
  }
  writeFileSync(join(codex, "config.toml"), originalNative);
  writeFileSync(join(codex, "opencodex.config.toml"), "# user-edited profile\n");
  expect(() => assertNativeAvailable(state)).toThrow();
  journal.originalProfile = Buffer.from("# user-edited profile\n").toString("base64");
  writePrivateJson(join(codex, "opencodex-journal.json"), journal);
  expect(() => assertNativeAvailable(state)).not.toThrow();
}));

test("persistent environment keeps OCX storage private and only targets an explicitly connected client", () => fixture((root, codex) => {
  const before = persistentEnvironment(root, "C:/actual-user", { OPENAI_API_KEY: "must-not-inherit", CODEX_HOME: codex });
  expect(before.CODEX_HOME).toBe(join(root, ".codex"));
  expect(before.OPENCODEX_HOME).toBe(join(root, ".opencodex"));
  expect(before.OPENAI_API_KEY).toBeUndefined();
  expect(before.OCX_TEST_HOME_GUARD).toBeUndefined();
  expect(persistentEnvironment(root, "C:/actual-user", {}, codex).CODEX_HOME).toBe(codex);
}));

test("import preserves connection intent, and persisted config cannot bypass an OFF choice", () => fixture((root) => {
  const path = join(root, "config.json");
  const current = { port: 10100, clientIntegrations: { codex: false, grok: false } };
  const imported = importedSettings({ providers: { example: { baseUrl: "https://example.com/v1" } }, defaultProvider: "example", clientIntegrations: { codex: true }, claudeCode: { enabled: true, systemEnv: true } }, current);
  writePrivateJson(path, imported);
  preparePreviewConfig(path, false, true);
  const actual = JSON.parse(readFileSync(path, "utf8"));
  expect(actual.providers).toEqual(imported.providers);
  expect(actual.clientIntegrations.codex).toBe(false);
  expect(actual.claudeCode.enabled).toBe(false);
  expect(actual.claudeCode.systemEnv).toBe(false);
  preparePreviewConfig(path, true, true);
  expect(JSON.parse(readFileSync(path, "utf8")).clientIntegrations.codex).toBe(true);
}));
