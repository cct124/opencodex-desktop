import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { copyTree, filesIn, removeDependencyBins, resetStage, runtimeEntries, verifyManifest, writeManifest } from "./package-layout";
import { packagePlatform, packageVersions } from "./platform";

const repo = resolve(import.meta.dir, "../..");
const versions = packageVersions(repo);
const platform = packagePlatform();
if (Bun.version !== versions.bunVersion) throw new Error("Use the repository's pinned Bun version");
if (!existsSync(join(repo, "gui/dist/index.html")) || !existsSync(join(repo, "src/generated/compatibility-version.json"))) throw new Error("Run build:gui before staging");
const stage = resetStage(repo);
for (const path of runtimeEntries) copyTree(join(repo, path), join(stage, path));
// Install the exact production graph into a fresh tree. No dependency lifecycle scripts run.
const install = Bun.spawnSync([process.execPath, "install", "--production", "--frozen-lockfile", "--ignore-scripts", "--backend", "copyfile"], {
  cwd: stage, stdout: "inherit", stderr: "inherit", windowsHide: true,
});
if (install.exitCode !== 0) throw new Error("Production dependency installation failed");
removeDependencyBins(join(stage, "node_modules"));
copyTree(process.execPath, join(stage, "node_modules/bun/bin", platform.bun));
const version = Bun.spawnSync([join(stage, "node_modules/bun/bin", platform.bun), "--version"], { stdout: "pipe", stderr: "pipe", windowsHide: true });
if (version.exitCode !== 0 || version.stdout.toString().trim() !== versions.bunVersion) throw new Error("Staged Bun does not match package version");

// Preserve npm license files in situ and collect the Rust license declarations and texts.
const metadata = Bun.spawnSync(["cargo", "metadata", "--locked", "--offline", "--format-version", "1", "--manifest-path", join(repo, "desktop/src-tauri/Cargo.toml")], { stdout: "pipe", stderr: "pipe", windowsHide: true });
if (metadata.exitCode !== 0) throw new Error("Cargo metadata unavailable; run cargo fetch --locked first");
const notices: string[] = ["OpenCodex Desktop third-party notices", "The original license files in node_modules accompany the shipped JavaScript dependencies."];
const bunNotices = join(repo, "desktop/licenses", `bun-${Bun.version}`);
copyTree(bunNotices, join(stage, "licenses", `bun-${Bun.version}`));
notices.push(`Bun ${Bun.version}: see licenses/bun-${Bun.version}/LICENSE.md for the runtime, linked libraries, and rebuilding instructions.`);
for (const dependency of JSON.parse(metadata.stdout.toString()).packages as { name: string; version: string; license: string | null; license_file: string | null; manifest_path: string; source: string | null }[]) {
  if (!dependency.source) continue;
  notices.push(`${dependency.name} ${dependency.version}: ${dependency.license ?? "see license file"}`);
  const directory = dirname(dependency.manifest_path);
  const texts = filesIn(directory).filter(file => /(^|\/)(licen[cs]e|copying|notice)([-_.].*)?$/i.test(file));
  if (dependency.license_file && !texts.includes(dependency.license_file)) texts.push(dependency.license_file);
  for (const text of texts) {
    const destination = join(stage, "licenses/rust", `${dependency.name}-${dependency.version}`, text);
    copyTree(join(directory, text), destination);
  }
}
mkdirSync(join(stage, "licenses"), { recursive: true });
writeFileSync(join(stage, "licenses/THIRD-PARTY-NOTICES.txt"), notices.join("\n") + "\n");
const manifest = writeManifest(stage, versions);
verifyManifest(stage);

const png = readFileSync(join(repo, "gui/public/favicon.png"));
const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
if (width > 256 || height > 256) throw new Error("Installer icon must be at most 256 pixels");
const icon = Buffer.alloc(22);
icon.writeUInt16LE(1, 2); icon.writeUInt16LE(1, 4);
icon[6] = width % 256; icon[7] = height % 256;
icon.writeUInt16LE(1, 10); icon.writeUInt16LE(32, 12);
icon.writeUInt32LE(png.length, 14); icon.writeUInt32LE(22, 18);
writeFileSync(join(repo, "desktop/.bundle/icon.ico"), Buffer.concat([icon, png]));
console.log(JSON.stringify({ staged: true, ...versions, platform: platform.id, files: Object.keys(manifest.files).length }));
