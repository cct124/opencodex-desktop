import { expect, test } from "bun:test";
import { shouldUseCodexWsUpstream } from "../../src/server/responses/ws-upstream";

test("managed desktop selects native HTTPS and preserves upstream WS endpoint restrictions", () => {
  const previous = process.env.OPENCODEX_DESKTOP_MANAGED;
  const native = "https://chatgpt.com/backend-api/codex/responses";
  const init = { method: "POST", body: JSON.stringify({ model: "gpt-6-astra", stream: true }) };
  try {
    process.env.OPENCODEX_DESKTOP_MANAGED = "1";
    expect(shouldUseCodexWsUpstream(native, init, "1.4.0")).toBe(false);
    expect(shouldUseCodexWsUpstream("https://gateway.example.com/v1/responses", init, "1.4.0", true)).toBe(false);
    expect(shouldUseCodexWsUpstream("https://api.openai.com/v1/responses", init, "1.4.0", true)).toBe(true);
    delete process.env.OPENCODEX_DESKTOP_MANAGED;
    expect(shouldUseCodexWsUpstream(native, init, "1.4.0")).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.OPENCODEX_DESKTOP_MANAGED;
    else process.env.OPENCODEX_DESKTOP_MANAGED = previous;
  }
});
