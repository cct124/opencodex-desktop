/** UI hint injected by the native window. This is never used as backend authority. */
export function isDesktopShell(): boolean {
  return typeof window !== "undefined"
    && (window as Window & { __OCX_DESKTOP__?: boolean }).__OCX_DESKTOP__ === true;
}

/** Navigation only opens the local control window; it never executes a host action. */
export function openDesktopControls(): void {
  window.location.assign("/desktop-controls");
}
