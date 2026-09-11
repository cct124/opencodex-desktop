import { isDesktopShell, openDesktopControls } from "../desktop-host";
import { useT } from "../i18n/shared";

export function DesktopNotice() {
  const t = useT();
  if (!isDesktopShell()) return null;
  return <div className="notice" style={{ marginBottom: 16 }}>
    <p>{t("desktop.controlsHint")}</p>
    <button type="button" className="btn btn-sm" onClick={openDesktopControls}>{t("desktop.controls")}</button>
  </div>;
}
