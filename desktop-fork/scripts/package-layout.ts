import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { packagePlatform } from "./platform";

export const runtimeEntries = ["src", "bin", "assets", "gui/dist", "desktop-fork/runtime", "package.json", "bun.lock", "LICENSE", "README.md", "AGENTS_INSTALL.md", "native/remote-workspace-helper/Cargo.toml", "native/remote-workspace-helper/Cargo.lock", "native/remote-workspace-helper/src"];

export function safeBuildDirectory(repo: string, directory: string): string {
  const root = realpathSync(repo);
  const allowed = join(root, "desktop-fork", ".bundle");
  // macOS /var (including tmpdir()) can be an alias of /private/var.
  const target = resolve(root, relative(resolve(repo), resolve(directory)));
  if (target !== allowed && !target.startsWith(allowed + sep)) throw new Error("Build output must stay inside desktop-fork/.bundle");
  for (let current = target; current !== root; current = dirname(current)) {
    if (existsSync(current) && (lstatSync(current).isSymbolicLink() || realpathSync(current).toLowerCase() !== current.toLowerCase())) {
      throw new Error("Build output must not traverse a link");
    }
  }
  return target;
}

export function copyTree(source: string, destination: string): void {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error("Package source contains a link");
  if (stat.isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const name of readdirSync(source).sort()) copyTree(join(source, name), join(destination, name));
  } else if (stat.isFile()) {
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    if (process.platform !== "win32") chmodSync(destination, stat.mode & 0o777);
  } else throw new Error("Package source is not a regular file or directory");
}

export function filesIn(root: string, directory = root): string[] {
  return readdirSync(directory).sort().flatMap(name => {
    const file = join(directory, name);
    const entry = lstatSync(file);
    if (entry.isSymbolicLink()) throw new Error("Package contains a link");
    return entry.isDirectory() ? filesIn(root, file) : [relative(root, file).split(sep).join("/")];
  });
}

export function fileDigest(path: string) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }

// The app starts Bun directly; npm's command shims are neither used nor shipped.
// On macOS they are symlinks. All other links remain rejected by filesIn/copyTree.
export function removeDependencyBins(directory: string): void {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stat = lstatSync(path);
    if (name === ".bin") {
      if (stat.isSymbolicLink()) unlinkSync(path);
      else rmSync(path, { recursive: true });
    } else if (stat.isDirectory() && !stat.isSymbolicLink()) removeDependencyBins(path);
  }
}

export function writeManifest(root: string, versions: { desktopVersion: string; runtimeVersion: string; bunVersion: string }, platform = packagePlatform().id) {
  const files = filesIn(root).filter(file => file !== "desktop-manifest.json");
  const manifest = { format: 2, ...versions, platform, files: Object.fromEntries(files.map(file => [file, fileDigest(join(root, file))])) };
  writeFileSync(join(root, "desktop-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

export function verifyManifest(root: string, platform = packagePlatform().id): void {
  const manifest = JSON.parse(readFileSync(join(root, "desktop-manifest.json"), "utf8"));
  if (manifest.format !== 2 || manifest.platform !== platform || !manifest.desktopVersion || !manifest.runtimeVersion || !manifest.bunVersion || typeof manifest.files !== "object" || !manifest.files || Array.isArray(manifest.files)) throw new Error("Invalid desktop manifest");
  for (const [file, digest] of Object.entries(manifest.files)) {
    if (isAbsolute(file) || file.split(/[\\/]/).some(part => part === ".." || part === "." || !part)) throw new Error("Invalid package path");
    if (fileDigest(join(root, file)) !== digest) throw new Error(`Resource checksum mismatch: ${file}`);
  }
  const actual = filesIn(root).filter(file => file !== "desktop-manifest.json");
  if (JSON.stringify(actual.sort()) !== JSON.stringify(Object.keys(manifest.files).sort())) throw new Error("Unexpected package files");
}

export function resetBuildDirectory(repo: string, name: "runtime" | "artifacts"): string {
  const stage = safeBuildDirectory(repo, join(repo, "desktop-fork/.bundle", name));
  if (existsSync(stage)) rmSync(stage, { recursive: true });
  mkdirSync(stage, { recursive: true });
  return stage;
}

export function resetStage(repo: string): string { return resetBuildDirectory(repo, "runtime"); }
