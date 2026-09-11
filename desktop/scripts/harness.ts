import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const repo = resolve(import.meta.dir, "../..");

/** Persistent-mode integration harness. Callers always provide their own client fixture. */
export async function launchPersistent(root: string, codex: string, source: string) {
  const session = join(root, "runs", `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(session, { recursive: true });
  const child = Bun.spawn([process.execPath, join(repo, "desktop/runtime/entry.ts"), session,
    "--persistent", "--data-root", root, "--codex-home", codex, "--source-config", source],
  { cwd: repo, stdin: "pipe", stdout: "pipe", stderr: Bun.file(join(session, "stderr.log")), windowsHide: true });
  const events: Record<string, any>[] = [];
  const log: string[] = [];
  const output = (async () => {
    let pending = "";
    const decoder = new TextDecoder();
    for await (const bytes of child.stdout) {
      pending += decoder.decode(bytes, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop()!;
      for (const line of lines) {
        log.push(line);
        if (line.startsWith("OCX_DESKTOP_EVENT ")) {
          const event = JSON.parse(line.slice("OCX_DESKTOP_EVENT ".length));
          if (event.pid === child.pid) events.push(event);
        }
      }
    }
    writeFileSync(join(session, "backend.log"), log.join("\n"), { mode: 0o600 });
  })();
  const wait = async (predicate: (event: Record<string, any>) => boolean, from = 0) => {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const event = events.slice(from).find(predicate);
      if (event) return event;
      const failure = events.slice(from).find(event => event.type === "error" || event.success === false);
      if (failure) throw new Error(`${failure.message}; inspect ${session}`);
      if (child.exitCode !== null) throw new Error(`Backend exited (${child.exitCode}); inspect ${session}`);
      await Bun.sleep(50);
    }
    throw new Error(`Backend timed out; inspect ${session}`);
  };
  const stop = async (disconnect = false) => {
    if (child.exitCode === null) {
      child.stdin.write(disconnect ? "shutdown-disconnect\n" : "shutdown\n");
      await child.stdin.flush();
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const code = await Promise.race([child.exited, new Promise<number>((_, reject) => { timeout = setTimeout(() => reject(new Error("Backend did not stop")), 140000); })])
      .finally(() => clearTimeout(timeout));
    await output;
    if (code !== 0) throw new Error(`Backend cleanup failed (${code}); inspect ${session}`);
  };
  try {
    const ready = await wait(event => event.type === "ready");
    return {
      child, session, url: ready.url as string, events, wait, stop,
      async command(command: string, type = "routing") {
        const from = events.length;
        child.stdin.write(`${command}\n`);
        await child.stdin.flush();
        return await wait(event => event.type === type && (type !== "routing" || typeof event.success === "boolean"), from);
      },
      async crash() { child.kill(); await child.exited; await output; },
    };
  } catch (error) { child.kill(); await child.exited; await output; throw error; }
}
