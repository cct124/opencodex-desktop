import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preparePreviewConfig } from "../runtime/profile";

test("restart preserves providers and the explicit session Codex routing choice", () => {
  const directory = mkdtempSync(join(tmpdir(), "ocx-desktop-profile-"));
  const path = join(directory, "config.json");
  try {
    preparePreviewConfig(path);
    const original = JSON.parse(readFileSync(path, "utf8"));
    original.providers = { example: { name: "Example", baseUrl: "https://example.com/v1" } };
    original.defaultProvider = "example";
    original.shutdownTimeoutMs = 4321;
    original.clientIntegrations.codex = true;
    original.claudeCode = { enabled: true, systemEnv: true, model: "example-model" };
    writeFileSync(path, JSON.stringify(original));
    expect(preparePreviewConfig(path).shutdownTimeoutMs).toBe(4321);
    const restored = JSON.parse(readFileSync(path, "utf8"));
    expect(restored.providers).toEqual(original.providers);
    expect(restored.defaultProvider).toBe("example");
    expect(restored.clientIntegrations.codex).toBe(true);
    expect(restored.clientIntegrations.grok).toBe(false);
    expect(restored.claudeCode).toEqual({ enabled: false, systemEnv: false, model: "example-model" });
    expect(restored.hostname).toBe("127.0.0.1");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("malformed settings are preserved for repair rather than replaced with defaults", () => {
  const directory = mkdtempSync(join(tmpdir(), "ocx-desktop-profile-"));
  const path = join(directory, "config.json");
  try {
    writeFileSync(path, "{malformed");
    expect(() => preparePreviewConfig(path)).toThrow();
    expect(readFileSync(path, "utf8")).toBe("{malformed");
    writeFileSync(path, "[]");
    expect(() => preparePreviewConfig(path)).toThrow();
    expect(readFileSync(path, "utf8")).toBe("[]");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
