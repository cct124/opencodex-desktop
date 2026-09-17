import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readConnection, writePrivateJson, type ConnectionState } from "../runtime/persistent";
import { selectDesktopPort } from "../runtime/port";

test("a saved port survives relaunch and clearing the native routing lease", async () => {
  const root = mkdtempSync(join(tmpdir(), "ocx-desktop-port-"));
  try {
    const state = readConnection(root, root);
    state.listenPort = await selectDesktopPort(state);
    writePrivateJson(join(root, "connection.json"), state);
    const restored = readConnection(root, root);
    expect(await selectDesktopPort(restored)).toBe(state.listenPort);
    restored.authorized = true;
    restored.lease = { pid: process.pid, port: state.listenPort };
    delete restored.lease;
    writePrivateJson(join(root, "connection.json"), restored);
    expect(await selectDesktopPort(readConnection(root, root))).toBe(state.listenPort);

    for (const listenPort of [0, -1, 65536, 1.5, "12345", null]) {
      writePrivateJson(join(root, "connection.json"), { ...restored, listenPort });
      const before = readFileSync(join(root, "connection.json"), "utf8");
      expect(() => readConnection(root, root)).toThrow("桌面连接记录无效");
      expect(readFileSync(join(root, "connection.json"), "utf8")).toBe(before);
    }
  } finally {
    if (resolve(dirname(root)) !== resolve(tmpdir())) throw new Error("Unexpected fixture path");
    rmSync(root, { recursive: true, force: true });
  }
});

test("an old connection record reuses its previous endpoint during upgrade", async () => {
  const port = await selectDesktopPort();
  const legacy: ConnectionState = { version: 1, authorized: true, reconnect: true, codexHome: "fixture", lease: { pid: process.pid, port } };
  expect(await selectDesktopPort(legacy)).toBe(port);
});

test("an occupied saved or legacy port fails instead of switching or attaching", async () => {
  let requests = 0;
  const foreign = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { requests++; return new Response("foreign"); } });
  try {
    const state: ConnectionState = { version: 1, authorized: true, reconnect: true, codexHome: "fixture", listenPort: foreign.port! };
    await expect(selectDesktopPort(state)).rejects.toThrow(`端口 ${foreign.port}`);
    delete state.listenPort;
    state.lease = { pid: process.pid, port: foreign.port! };
    await expect(selectDesktopPort(state)).rejects.toThrow("不会自动改用其他端口");
    expect(requests).toBe(0);
  } finally { await foreign.stop(true); }
});
