import {
  createLocalAttestationChallenge,
  LOCAL_ATTESTATION_CHALLENGE_HEADER,
  LOCAL_ATTESTATION_PROOF_HEADER,
  verifyLocalAttestationProof,
} from "../../src/lib/local-management-attestation";

export async function ownedBackendReady(port: number, pid: number, secret: string): Promise<boolean> {
  const url = `http://127.0.0.1:${port}`;
  const challenge = createLocalAttestationChallenge();
  const health = await fetch(`${url}/healthz`, {
    headers: { [LOCAL_ATTESTATION_CHALLENGE_HEADER]: challenge },
    signal: AbortSignal.timeout(1000),
    redirect: "error",
  });
  if (!health.ok || !verifyLocalAttestationProof(secret, challenge, pid, port, health.headers.get(LOCAL_ATTESTATION_PROOF_HEADER))) return false;
  const identity = await health.json() as Record<string, unknown>;
  if (identity.service !== "opencodex" || identity.pid !== pid || identity.port !== port) return false;
  const ready = await fetch(`${url}/readyz`, { signal: AbortSignal.timeout(1000), redirect: "error" });
  if (!ready.ok) return false;
  const body = await ready.json() as Record<string, unknown>;
  return body.service === "opencodex" && body.pid === pid && body.port === port && body.status === "ready";
}
