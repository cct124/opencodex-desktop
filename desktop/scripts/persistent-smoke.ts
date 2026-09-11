import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { launchPersistent, repo } from "./harness";

function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
const protectedPaths = [join(homedir(), ".opencodex/config.json"), join(homedir(), ".codex/config.toml")];
const fingerprints = () => protectedPaths.map(path => existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null);
const before = fingerprints();
const root = mkdtempSync(join(repo, ".tmp/desktop/persistent-"));
const client = join(root, "client-fixture");
mkdirSync(client);
const native = '# Desktop persistent smoke\nmodel = "gpt-5.4"\n';
writeFileSync(join(client, "config.toml"), native);
let requests = 0;
const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  if (new URL(request.url).pathname.endsWith("/models")) return Response.json({ object: "list", data: [{ id: "desktop-test", object: "model" }] });
  const body = await request.json() as any;
  if (body.model !== "desktop-test") return Response.json({ error: "unexpected model" }, { status: 400 });
  requests++;
  const chunk = (delta: object, reason: string | null = null) => `data: ${JSON.stringify({ id: "chatcmpl-desktop-test", object: "chat.completion.chunk", created: 1, model: "desktop-test", choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`;
  return new Response(chunk({ role: "assistant", content: "desktop-ok" }) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
} });
const key = `ocx_${randomUUID().replaceAll("-", "")}`;
const source = join(root, "original-config.json");
const config = { providers: { fixture: { adapter: "openai-chat", baseUrl: `http://127.0.0.1:${provider.port}/v1`, allowPrivateNetwork: true, apiKey: "fixture-placeholder" } }, defaultProvider: "fixture",
  customModels: [{ id: "desktop-fixture", provider: "fixture", modelId: "desktop-test" }],
  apiKeys: [{ id: "desktop-smoke", name: "Desktop smoke", key, createdAt: new Date().toISOString() }], shutdownTimeoutMs: 1000 };
writeFileSync(source, JSON.stringify(config));
const sourceBefore = readFileSync(source, "utf8");
let app: Awaited<ReturnType<typeof launchPersistent>> | undefined;
const steps: string[] = [];
try {
  app = await launchPersistent(root, client, source);
  check(readFileSync(join(client, "config.toml"), "utf8") === native, "First launch modified the native client");
  await app.command("import-existing", "reconfigure");
  await app.stop();
  app = await launchPersistent(root, client, source);
  const imported = JSON.parse(readFileSync(join(root, ".opencodex/config.json"), "utf8"));
  check(imported.providers.fixture.baseUrl === config.providers.fixture.baseUrl, "Imported provider did not persist");
  check(readFileSync(source, "utf8") === sourceBefore, "Import modified the original config");
  check(readdirSync(join(root, ".opencodex/backups")).length === 1, "Import did not back up desktop settings");
  check(readFileSync(join(client, "config.toml"), "utf8") === native, "Import connected without consent");
  steps.push("import_backup_and_full_relaunch_preserve_settings_without_connecting");
  const beforeInvalid = readFileSync(join(root, ".opencodex/config.json"), "utf8");
  const invalid = await app.command(JSON.stringify({ type: "import-config", config: "{broken" }));
  check(invalid.success === false && readFileSync(join(root, ".opencodex/config.json"), "utf8") === beforeInvalid, "Invalid import changed settings");
  steps.push("invalid_import_keeps_current_settings");
  await app.command("restore-back", "reconfigure");
  await app.stop();
  app = await launchPersistent(root, client, source);
  check(readFileSync(join(client, "config.toml"), "utf8").includes(app.url.replace(/\/$/, "")), "Explicit connection did not use the owned port");
  const response = await fetch(`${app.url}v1/responses`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "fixture/desktop-test", input: "Reply desktop-ok", stream: true }), signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  check(response.ok && text.includes("desktop-ok") && text.includes("response.completed") && requests === 1, `Streaming request failed (${response.status}); inspect backend logs`);
  steps.push("responses_stream_traverses_the_desktop_backend_to_the_provider");
  const pid = app.child.pid;
  check((await app.command("restore")).success, "Restore failed");
  check(readFileSync(join(client, "config.toml"), "utf8") === native, "Restore did not recover exact config");
  check((await app.command("restore-back")).success && app.child.pid === pid, "Reconnect restarted the backend");
  await app.stop();
  check(readFileSync(join(client, "config.toml"), "utf8") === native, "Quit did not restore native config");
  app = await launchPersistent(root, client, source);
  check(readFileSync(join(client, "config.toml"), "utf8").includes(app.url.replace(/\/$/, "")), "Relaunch forgot the explicit connection choice");
  steps.push("restore_reconnect_and_quit_relaunch_preserve_the_connection_choice");
  await app.crash();
  app = await launchPersistent(root, client, source);
  check(readFileSync(join(client, "config.toml"), "utf8").includes(app.url.replace(/\/$/, "")), "Crash recovery did not reconnect");
  await app.stop(true);
  check(readFileSync(join(client, "config.toml"), "utf8") === native, "Stop failed to recover the original baseline after crash");
  app = await launchPersistent(root, client, source);
  check(readFileSync(join(client, "config.toml"), "utf8") === native, "Explicit stop did not cancel automatic connection");
  await app.stop();
  steps.push("crash_recovery_restores_original_baseline_and_explicit_stop_cancels_reconnect");
  app = await launchPersistent(root, client, source);
  check((await app.command("restore-back")).success, "Could not prepare ambiguous cleanup case");
  const malformed = 'openai_base_url = "unterminated';
  writeFileSync(join(client, "config.toml"), malformed);
  app.child.stdin.write("shutdown\n");
  await app.child.stdin.flush();
  check(await app.child.exited === 1, "Ambiguous cleanup must report failure");
  check(readFileSync(join(client, "config.toml"), "utf8") === malformed, "Shutdown overwrote an ambiguous client edit");
  check(!existsSync(join(root, ".opencodex/runtime-port.json")), "Failed restore did not clean up the backend");
  steps.push("ambiguous_client_edits_are_preserved_while_shutdown_reports_failure_and_reaps_backend");
  check(JSON.stringify(before) === JSON.stringify(fingerprints()), "Real user configuration changed");
  console.log(JSON.stringify({ ok: true, steps, realConfigUnchanged: true, root }));
} finally {
  if (app?.child.exitCode === null) await app.stop();
  await provider.stop(true);
}
