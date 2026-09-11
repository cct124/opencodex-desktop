import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** The preview owns its session profile; never inherit provider or client routing variables. */
export function isolatedEnvironment(session: string, realHome: string, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Rust canonicalize() produces extended Windows paths. PowerShell 5.1 Add-Type
  // cannot use that spelling for TEMP, so retain the same directory in Win32 form.
  if (session.startsWith("\\\\?\\UNC\\")) session = "\\\\" + session.slice(8);
  else if (session.startsWith("\\\\?\\") && /^[A-Za-z]:[\\/]/.test(session.slice(4))) session = session.slice(4);
  const env: NodeJS.ProcessEnv = {};
  const allowed = new Set(["path", "pathext", "systemroot", "windir", "comspec", "processor_architecture", "number_of_processors"]);
  for (const [key, value] of Object.entries(base)) {
    if (allowed.has(key.toLowerCase())) env[key] = value;
  }
  return {
    ...env,
    HOME: session,
    USERPROFILE: session,
    APPDATA: join(session, "AppData", "Roaming"),
    LOCALAPPDATA: join(session, "AppData", "Local"),
    TEMP: join(session, "temp"),
    TMP: join(session, "temp"),
    OPENCODEX_HOME: join(session, ".opencodex"),
    CODEX_HOME: join(session, ".codex"),
    CLAUDE_CONFIG_DIR: join(session, ".claude"),
    CLAUDE_USER_DATA_DIR: join(session, "claude-desktop"),
    OPENCODEX_CLAUDE_DESKTOP_CONFIG_DIR: join(session, "claude-desktop", "configLibrary"),
    XDG_CONFIG_HOME: join(session, ".config"),
    // Reuse upstream's development guard, including its live service-manager refusal.
    OCX_REAL_HOME: realHome,
    OCX_TEST_HOME_GUARD: "1",
    OPENCODEX_DESKTOP_PREVIEW: "1",
    CI: "1",
    TERM: "dumb",
  };
}

export function prepareDirectories(env: NodeJS.ProcessEnv): void {
  for (const key of ["HOME", "APPDATA", "LOCALAPPDATA", "TEMP", "OPENCODEX_HOME", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "OPENCODEX_CLAUDE_DESKTOP_CONFIG_DIR", "XDG_CONFIG_HOME"]) {
    mkdirSync(env[key]!, { recursive: true });
  }
}
