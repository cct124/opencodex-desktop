import { describe, expect, test } from "bun:test";
import { isolatedEnvironment } from "../runtime/environment";
import { ownedBackendReady } from "../runtime/readiness";
import { createLocalAttestationProof, createLocalAttestationSecret, LOCAL_ATTESTATION_CHALLENGE_HEADER, LOCAL_ATTESTATION_PROOF_HEADER } from "../../src/lib/local-management-attestation";
import { join } from "node:path";

describe("isolated desktop preview", () => {
  test("redirects user directories and removes inherited provider, routing and service authority", () => {
    const session = join(import.meta.dir, "example-session");
    const env = isolatedEnvironment(session, "real-profile", { PATH: "tools", OPENCODEX_HOME: "live", CODEX_HOME: "live-codex", OCX_SERVICE: "1", OPENAI_API_KEY: "private", HTTP_PROXY: "foreign", CLAUDE_USER_DATA_DIR: "live-claude" });
    expect(env.OPENCODEX_HOME).toBe(join(session, ".opencodex"));
    expect(env.CODEX_HOME).toBe(join(session, ".codex"));
    expect(env.CLAUDE_USER_DATA_DIR).toBe(join(session, "claude-desktop"));
    expect(env.OCX_REAL_HOME).toBe("real-profile");
    expect(env.OCX_TEST_HOME_GUARD).toBe("1");
    expect(env.PATH).toBe("tools");
    for (const key of ["OCX_SERVICE", "OPENAI_API_KEY", "HTTP_PROXY"]) expect(env[key]).toBeUndefined();
  });

  test("requires matching process identity, attestation and readiness", async () => {
    const secret = createLocalAttestationSecret();
    let mode = "ready";
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req, instance) {
      const path = new URL(req.url).pathname;
      const pid = mode === "foreign-pid" ? process.pid + 1 : process.pid;
      const headers = new Headers();
      if (path === "/healthz" && mode !== "missing-proof") {
        const challenge = req.headers.get(LOCAL_ATTESTATION_CHALLENGE_HEADER)!;
        headers.set(LOCAL_ATTESTATION_PROOF_HEADER, createLocalAttestationProof(secret, challenge, pid, instance.port!)!);
      }
      return Response.json({ service: "opencodex", pid, port: instance.port, status: path === "/healthz" ? "ok" : mode }, { headers });
    } });
    try {
      expect(await ownedBackendReady(server.port!, process.pid, secret)).toBe(true);
      for (const candidate of ["pending", "failed", "missing-proof", "foreign-pid"]) {
        mode = candidate;
        expect(await ownedBackendReady(server.port!, process.pid, secret)).toBe(false);
      }
      mode = "ready";
      expect(await ownedBackendReady(server.port!, process.pid, createLocalAttestationSecret())).toBe(false);
    } finally { await server.stop(true); }
  });
});
