import {
  createLocalAttestationChallenge,
  LOCAL_ATTESTATION_CHALLENGE_HEADER,
  LOCAL_ATTESTATION_PROOF_HEADER,
  verifyLocalAttestationProof,
} from "../../src/lib/local-management-attestation";

export type BackendStatus = "unavailable" | "pending" | "ready" | "failed";

export async function ownedBackendStatus(port: number, pid: number, secret: string): Promise<BackendStatus> {
  const url = `http://127.0.0.1:${port}`;
  const challenge = createLocalAttestationChallenge();
  const health = await fetch(`${url}/healthz`, {
    headers: { [LOCAL_ATTESTATION_CHALLENGE_HEADER]: challenge },
    signal: AbortSignal.timeout(1000),
    redirect: "error",
  });
  if (!health.ok || !verifyLocalAttestationProof(secret, challenge, pid, port, health.headers.get(LOCAL_ATTESTATION_PROOF_HEADER))) return "unavailable";
  const identity = await health.json() as Record<string, unknown>;
  if (identity.service !== "opencodex" || identity.pid !== pid || identity.port !== port) return "unavailable";
  const ready = await fetch(`${url}/readyz`, { signal: AbortSignal.timeout(1000), redirect: "error" });
  if (ready.status !== 200 && ready.status !== 503) return "unavailable";
  const body = await ready.json() as Record<string, unknown>;
  if (body.service !== "opencodex" || body.pid !== pid || body.port !== port) return "unavailable";
  if (ready.status === 200 && body.status === "ready") return "ready";
  if (ready.status === 503 && (body.status === "pending" || body.status === "failed")) return body.status;
  return "unavailable";
}

export async function ownedBackendReady(port: number, pid: number, secret: string): Promise<boolean> {
  return await ownedBackendStatus(port, pid, secret) === "ready";
}
