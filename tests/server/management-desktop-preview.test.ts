import { describe, expect, test } from "bun:test";
import { desktopPreviewBlocksHostAction } from "../../src/server/desktop-preview";
import { getDefaultConfig } from "../../src/config";
import { handleManagementAPI } from "../../src/server/management-api";

describe("desktop preview host actions", () => {
  test("management API refuses a host action before calling its implementation", async () => {
    const previous = process.env.OPENCODEX_DESKTOP_PREVIEW;
    process.env.OPENCODEX_DESKTOP_PREVIEW = "1";
    let called = false;
    try {
      const url = new URL("http://127.0.0.1:12345/api/startup-action");
      const response = await handleManagementAPI(new Request(url, { method: "POST", headers: { Host: url.host }, body: JSON.stringify({ action: "install-service" }) }), url, getDefaultConfig(), {
        runStartupInstallAction: async () => { called = true; throw new Error("must not execute"); },
      });
      expect(response?.status).toBe(409);
      expect(called).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.OPENCODEX_DESKTOP_PREVIEW;
      else process.env.OPENCODEX_DESKTOP_PREVIEW = previous;
    }
  });
  test("requires explicit preview mode and preserves ordinary reads and provider editing", () => {
    expect(desktopPreviewBlocksHostAction("POST", "/api/update/run", false)).toBe(false);
    expect(desktopPreviewBlocksHostAction("GET", "/api/windows-tray", true)).toBe(false);
    expect(desktopPreviewBlocksHostAction("POST", "/api/providers", true)).toBe(false);
    expect(desktopPreviewBlocksHostAction("PUT", "/api/providers/example", true)).toBe(false);
    expect(desktopPreviewBlocksHostAction("POST", "/v1/responses", true)).toBe(false);
  });
  test("blocks global installation, lifecycle actions and integration ownership changes", () => {
    for (const path of ["/api/update/run", "/api/startup-action", "/api/windows-tray", "/api/system/restart", "/api/system/codex-restart", "/api/claude-desktop/apply", "/api/client-integrations/codex", "/api/client-integrations/aside/profiles/1/restore"]) {
      expect(desktopPreviewBlocksHostAction("POST", path, true)).toBe(true);
      expect(desktopPreviewBlocksHostAction("PUT", path, true)).toBe(true);
    }
  });
});
