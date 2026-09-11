// The source-checkout desktop preview owns only its isolated backend. These
// operations target global installation/process state or transfer that ownership.
// The normal CLI and production proxy are unaffected unless explicitly opted in.
const HOST_ACTIONS = new Set([
  "/api/startup-action",
  "/api/windows-tray",
  "/api/update/run",
  "/api/system/restart",
  "/api/system/codex-restart",
  "/api/claude-desktop/apply",
]);

export function desktopPreviewBlocksHostAction(method: string, pathname: string, preview = process.env.OPENCODEX_DESKTOP_PREVIEW === "1" || process.env.OPENCODEX_DESKTOP_MANAGED === "1"): boolean {
  if (!preview || method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  return HOST_ACTIONS.has(pathname)
    || pathname === "/api/client-integrations"
    || pathname.startsWith("/api/client-integrations/");
}

/** The desktop owner only restores a route it has explicitly connected and still owns. */
export function desktopRestoresCodexOnShutdown(): boolean {
  return process.env.OPENCODEX_DESKTOP_MANAGED !== "1" || process.env.OPENCODEX_DESKTOP_SKIP_CODEX_RESTORE !== "1";
}
