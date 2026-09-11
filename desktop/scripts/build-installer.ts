import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileDigest, verifyManifest } from "./package-layout";

const desktop = resolve(import.meta.dir, "..");
const repo = resolve(desktop, "..");
function run(args: string[], cwd: string) {
  const result = Bun.spawnSync(args, { cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit", windowsHide: true,
    env: { ...process.env, PATH: `${join(repo, "node_modules/bun/bin")};${process.env.PATH ?? ""}` } });
  if (result.exitCode !== 0) throw new Error(`Build step failed (${result.exitCode}): ${args[1] ?? args[0]}`);
}
run([process.execPath, "run", "build:gui"], repo);
run([process.execPath, join(desktop, "scripts/stage-runtime.ts")], repo);
verifyManifest(join(desktop, ".bundle/runtime"));
run([process.execPath, join(desktop, "node_modules/@tauri-apps/cli/tauri.js"), "build", "--config", "src-tauri/tauri.bundle.conf.json", "--", "--locked", "--offline"], desktop);
const version = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
const installer = join(desktop, "src-tauri/target/release/bundle/nsis", `OpenCodex Desktop_${version}_x64-setup.exe`);
if (!existsSync(installer)) throw new Error("Tauri did not produce the expected x64 installer");
writeFileSync(installer + ".sha256", `${fileDigest(installer)}  OpenCodex Desktop_${version}_x64-setup.exe\n`);
console.log(`Installer: ${installer}`);
