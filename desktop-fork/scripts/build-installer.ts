import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { basename, delimiter, join, resolve } from "node:path";
import { fileDigest, resetBuildDirectory, verifyManifest } from "./package-layout";
import { packagePlatform, packageVersions } from "./platform";

const desktop = resolve(import.meta.dir, "..");
const repo = resolve(desktop, "..");
const platform = packagePlatform();
if (process.env.DESKTOP_BUILD_PLATFORM && process.env.DESKTOP_BUILD_PLATFORM !== platform.id) throw new Error("Build host architecture does not match the requested installer");
const versions = packageVersions(repo);
const cli = join(desktop, "node_modules/@tauri-apps/cli/tauri.js");
const artifacts = resetBuildDirectory(repo, "artifacts");
function run(args: string[], cwd: string) {
  const result = Bun.spawnSync(args, { cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit", windowsHide: true,
    env: { ...process.env, PATH: `${join(repo, "node_modules/bun/bin")}${delimiter}${process.env.PATH ?? ""}` } });
  if (result.exitCode !== 0) throw new Error(`Build step failed (${result.exitCode}): ${args[1] ?? args[0]}`);
}
run([process.execPath, "run", "build:gui"], repo);
run([process.execPath, join(desktop, "scripts/stage-runtime.ts")], repo);
verifyManifest(join(desktop, ".bundle/runtime"));
if (process.platform === "darwin") {
  run([process.execPath, cli, "icon", join(repo, "gui/public/favicon.png"), "--output", join(desktop, ".bundle/icons")], desktop);
}
const config = process.platform === "win32" ? "tauri.bundle.conf.json" : "tauri.macos.bundle.conf.json";
run([process.execPath, cli, "build", "--config", `src-tauri/${config}`, "--", "--locked", "--offline"], desktop);
const filename = `OpenCodex Desktop_${versions.desktopVersion}_${platform.arch}${platform.bundle === "nsis" ? "-setup.exe" : ".dmg"}`;
const installer = join(desktop, "src-tauri/target/release/bundle", platform.bundle, filename);
if (!existsSync(installer)) throw new Error(`Tauri did not produce the expected installer: ${filename}`);
writeFileSync(installer + ".sha256", `${fileDigest(installer)}  ${basename(installer)}\n`);
// Upload only this build's installer and metadata, never old target/ outputs or runtime data.
for (const file of [installer, installer + ".sha256"]) copyFileSync(file, join(artifacts, basename(file)));
writeFileSync(join(artifacts, "build-info.json"), JSON.stringify({ ...versions, platform: platform.id, commit: process.env.GITHUB_SHA ?? null, installer: filename, sha256: fileDigest(installer) }, null, 2) + "\n");
console.log(`Installer: ${installer}`);
