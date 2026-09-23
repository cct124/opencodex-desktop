import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Only native builds: the packaged Bun and native dependencies must match Rust. */
export function packagePlatform(platform: string = process.platform, arch: string = process.arch) {
  if (platform === "win32" && arch === "x64") return { id: "win32-x64", bun: "bun.exe", bundle: "nsis", arch: "x64" };
  if (platform === "darwin" && (arch === "x64" || arch === "arm64")) return { id: `darwin-${arch}`, bun: "bun", bundle: "dmg", arch: arch === "arm64" ? "aarch64" : "x64" };
  throw new Error(`Unsupported desktop build host: ${platform}-${arch}`);
}

export function packageVersions(repo: string) {
  const runtime = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  const desktop = JSON.parse(readFileSync(join(repo, "desktop-fork/package.json"), "utf8"));
  const cargo = Bun.TOML.parse(readFileSync(join(repo, "desktop-fork/src-tauri/Cargo.toml"), "utf8")) as { package: { version: string } };
  if (!/^\d+\.\d+\.\d+$/.test(desktop.version) || cargo.package.version !== desktop.version) {
    throw new Error("Use matching desktop-fork/package.json and Cargo.toml versions (major.minor.patch)");
  }
  return { desktopVersion: desktop.version as string, runtimeVersion: runtime.version as string, bunVersion: runtime.dependencies.bun as string };
}
