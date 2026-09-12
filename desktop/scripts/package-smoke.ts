import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { launchPersistent, repo } from "./harness";
import { copyTree, verifyManifest } from "./package-layout";
import { packagePlatform, packageVersions } from "./platform";

const staged = resolve(process.argv[2] ?? join(repo, "desktop/.bundle/runtime"));
verifyManifest(staged);
mkdirSync(join(repo, ".tmp/desktop"), { recursive: true });
const testRoot = mkdtempSync(join(repo, ".tmp/desktop/package-"));
// Relocation and spaces/non-ASCII paths catch accidental checkout and shell dependencies.
const runtime = join(testRoot, "独立安装 App/runtime");
copyTree(staged, runtime);
const data = join(testRoot, "data");
const client = join(data, "client");
mkdirSync(client, { recursive: true });
const original = '# packaged smoke\nmodel = "gpt-5.4"\n';
writeFileSync(join(client, "config.toml"), original);
const windows = process.env.SystemRoot ?? "C:\\Windows";
const env = { ...process.env, PATH: process.platform === "win32" ? [windows, join(windows, "System32"), join(windows, "System32/WindowsPowerShell/v1.0")].join(";") : "/usr/bin:/bin:/usr/sbin:/sbin" };
const launch = () => launchPersistent(data, client, join(testRoot, "absent-source.json"), runtime, join(runtime, "node_modules/bun/bin", packagePlatform().bun), env);
let requests = 0;
const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  if (new URL(request.url).pathname.endsWith("/models")) return Response.json({ object: "list", data: [{ id: "desktop-package-test", object: "model" }] });
  const body = await request.json() as { model?: string };
  if (body.model !== "desktop-package-test") return Response.json({ error: "unexpected model" }, { status: 400 });
  requests++;
  const chunk = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: "chatcmpl-package-test", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return new Response(chunk({ role: "assistant", content: "packaged-provider-ok" }) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
} });
let app: Awaited<ReturnType<typeof launch>> | undefined;
try {
  app = await launch();
  const page = await fetch(app.url, { signal: AbortSignal.timeout(10000) });
  if (!page.ok || !(await page.text()).includes("<html")) throw new Error("Packaged dashboard did not load");
  const health = await (await fetch(new URL("healthz", app.url))).json() as { version?: string; pid?: number };
  if (health.pid !== app.child.pid) throw new Error("Packaged process identity mismatch");
  if (health.version !== packageVersions(repo).runtimeVersion) throw new Error("Packaged proxy version mismatch");
  if (readFileSync(join(client, "config.toml"), "utf8") !== original) throw new Error("Unconnected client was modified");
  const key = `ocx_${randomUUID().replaceAll("-", "")}`;
  const config = { providers: { fixture: { adapter: "openai-chat", baseUrl: `http://127.0.0.1:${provider.port}/v1`, allowPrivateNetwork: true, apiKey: "fixture-placeholder" } }, defaultProvider: "fixture",
    apiKeys: [{ id: "package-smoke", name: "Package smoke", key, createdAt: new Date().toISOString() }], shutdownTimeoutMs: 1000 };
  await app.command(JSON.stringify({ type: "import-config", config: JSON.stringify(config) }), "reconfigure");
  await app.stop();
  app = await launch();
  if (readdirSync(join(data, ".opencodex/backups")).length !== 1) throw new Error("Import did not create a settings backup");
  const response = await fetch(new URL("v1/responses", app.url), { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "fixture/desktop-package-test", input: "Reply packaged-provider-ok", stream: true }), signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  if (!response.ok || !text.includes("packaged-provider-ok") || !text.includes("response.completed") || requests !== 1) throw new Error("Packaged provider stream did not complete exactly once");
  if (readFileSync(join(client, "config.toml"), "utf8") !== original) throw new Error("Import or request changed the unconnected client");
  await app.stop();
  verifyManifest(runtime);
  console.log(JSON.stringify({ ok: true, version: health.version, relocatedRuntime: true, systemOnlyPath: true, settingsPersistedAndBackedUp: true, mockProviderStreamCompleted: true, resourcesUnmodified: true, fixtureUnchanged: true }));
} finally {
  try { if (app?.child.exitCode === null) await app.stop(); }
  finally { provider.stop(true); }
}
