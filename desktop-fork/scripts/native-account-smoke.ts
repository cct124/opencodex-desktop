import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { launchPersistent, repo } from "./harness";

// This opt-in check sends one short live request. It never copies credentials to disk.
if (!process.argv.includes("--allow-native-request")) throw new Error("Explicit --allow-native-request is required.");
const nativeHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
const auth = JSON.parse(readFileSync(join(nativeHome, "auth.json"), "utf8"));
const accessToken = auth.tokens?.access_token;
const accountId = auth.tokens?.account_id;
if (typeof accessToken !== "string" || typeof accountId !== "string") throw new Error("A native Codex ChatGPT login is required.");
const claims = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString());
if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now() + 120000) throw new Error("The native access token needs refreshing in Codex before this check. This check does not refresh credentials.");
const protectedPaths = [join(nativeHome, "config.toml"), join(nativeHome, "auth.json"), join(homedir(), ".opencodex/config.json")];
const fingerprints = () => protectedPaths.map(path => existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null);
const before = fingerprints();
const configured = Bun.TOML.parse(readFileSync(join(nativeHome, "config.toml"), "utf8")) as { model?: string };
const modelIndex = process.argv.indexOf("--model");
const model = modelIndex >= 0 ? process.argv[modelIndex + 1] : configured.model?.startsWith("gpt-") ? configured.model : "gpt-5.4";
if (!model?.startsWith("gpt-")) throw new Error("A native Codex model is required.");
const root = mkdtempSync(join(repo, ".tmp/desktop/native-account-"));
const client = join(root, "client-fixture");
mkdirSync(client);
writeFileSync(join(client, "config.toml"), 'model = "gpt-5.4"\n');
let app: Awaited<ReturnType<typeof launchPersistent>> | undefined;
try {
  app = await launchPersistent(root, client, join(root, "unused-import.json"));
  const direct = process.argv.includes("--direct-http-diagnostic");
  const response = await fetch(direct ? "https://chatgpt.com/backend-api/codex/responses" : `${app.url}v1/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "ChatGPT-Account-ID": accountId, "Content-Type": "application/json", "OpenAI-Beta": "responses=experimental", originator: "codex_cli_rs" },
    body: JSON.stringify({ model, instructions: "Reply briefly.", input: [{ role: "user", content: [{ type: "input_text", text: "Reply with exactly desktop-ok." }] }], stream: true, store: false }),
    signal: AbortSignal.timeout(90000),
  });
  const body = await response.text();
  // Do not print response headers/body: they can contain account or request identifiers.
  const completed = body.includes('"type":"response.completed"') || body.includes('"type": "response.completed"');
  const expectedText = body.includes("desktop-ok");
  if (!response.ok || !completed || !expectedText) {
    const errors: string[] = [];
    const summarize = (error: any) => String(error?.message ?? error?.code ?? "Unknown upstream error").replaceAll(accessToken, "[redacted]").replaceAll(accountId, "[redacted]").slice(0, 240);
    try { const document = JSON.parse(body); if (document.error) errors.push(summarize(document.error)); } catch { /* SSE below */ }
    for (const line of body.split("\n")) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      try {
        const event = JSON.parse(line.slice(6));
        const error = event.error ?? event.response?.error;
        if (error) errors.push(summarize(error));
      } catch { /* no raw body output */ }
    }
    throw new Error(`Native request did not complete (HTTP ${response.status}, model=${model}): ${errors.join("; ") || "No completion event"}`);
  }
  await app.stop();
  if (JSON.stringify(before) !== JSON.stringify(fingerprints())) throw new Error("Original client configuration or credentials changed.");
  console.log(JSON.stringify({ ok: true, throughDesktop: !direct, model, httpStatus: response.status, streamCompleted: completed, expectedText, realConfigAndCredentialsUnchanged: true }));
} finally { if (app?.child.exitCode === null) await app.stop(); }
