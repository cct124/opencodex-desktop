import { join } from "node:path";

export type RoutingAction = "restore" | "restore-back";
export interface RoutingResult { success: boolean; message: string }

/** Run the unmodified source CLI inside the already-isolated desktop environment. */
export async function runRoutingCommand(repo: string, action: RoutingAction): Promise<RoutingResult> {
  const args = [process.execPath, join(repo, "src/cli/index.ts"), "restore"];
  if (action === "restore-back") args.push("back");
  args.push("--json");
  const child = Bun.spawn(args, { cwd: repo, env: { ...process.env }, stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 45000);
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    // Original diagnostic output belongs in the owned backend log, not the tray label.
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    let result: { success?: boolean } | undefined;
    for (const line of stdout.trim().split(/\r?\n/).reverse()) {
      try { const candidate = JSON.parse(line); if (typeof candidate.success === "boolean") { result = candidate; break; } } catch { /* upstream may also print catalog diagnostics */ }
    }
    const success = !timedOut && code === 0 && result?.success === true;
    return {
      success,
      message: success
        ? action === "restore" ? "已恢复原生 Codex，代理继续运行。" : "Codex 已重新接回当前代理。"
        : timedOut ? "Codex 切换超时，请检查日志后重试；未确认切换完成。" : "Codex 切换未完成，请检查后端日志后重试。",
    };
  } finally { clearTimeout(timeout); }
}

/** Shutdown joins an admitted routing operation; it cannot race its file writes. */
export class RoutingGate {
  private flight: Promise<void> | undefined;
  private closing = false;
  run(operation: () => Promise<void>): boolean {
    if (this.closing || this.flight) return false;
    this.flight = operation().finally(() => { this.flight = undefined; });
    return true;
  }
  async close(): Promise<void> {
    this.closing = true;
    await this.flight;
  }
}
