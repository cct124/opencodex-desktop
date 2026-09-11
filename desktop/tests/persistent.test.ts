import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertNativeAvailable, assertPreviousBackendStopped, DesktopConnectionError, importedSettings, ownsNativeRoute, readConnection, writePrivateJson } from "../runtime/persistent";
import { persistentEnvironment } from "../runtime/environment";
import { preparePreviewConfig } from "../runtime/profile";

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
