import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const runtimeEntries = ["src", "bin", "assets", "gui/dist", "desktop/runtime", "package.json", "bun.lock", "LICENSE", "README.md", "AGENTS_INSTALL.md"];

export function safeBuildDirectory(repo: string, directory: string): string {
  const root = realpathSync(repo);
  const allowed = join(root, "desktop", ".bundle");
  const target = resolve(directory);
  if (target !== allowed && !target.startsWith(allowed + sep)) throw new Error("Build output must stay inside desktop/.bundle");
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

export function writeManifest(root: string, version: string, bunVersion: string) {
  const files = filesIn(root).filter(file => file !== "desktop-manifest.json");
  const manifest = { format: 1, version, bunVersion, platform: "win32-x64", files: Object.fromEntries(files.map(file => [file, fileDigest(join(root, file))])) };
  writeFileSync(join(root, "desktop-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

export function verifyManifest(root: string): void {
  const manifest = JSON.parse(readFileSync(join(root, "desktop-manifest.json"), "utf8"));
  if (manifest.format !== 1 || manifest.platform !== "win32-x64" || typeof manifest.files !== "object" || !manifest.files) throw new Error("Invalid desktop manifest");
  for (const [file, digest] of Object.entries(manifest.files)) {
    if (isAbsolute(file) || file.split(/[\\/]/).some(part => part === ".." || part === "." || !part)) throw new Error("Invalid package path");
    if (fileDigest(join(root, file)) !== digest) throw new Error(`Resource checksum mismatch: ${file}`);
  }
  const actual = filesIn(root).filter(file => file !== "desktop-manifest.json");
  if (JSON.stringify(actual.sort()) !== JSON.stringify(Object.keys(manifest.files).sort())) throw new Error("Unexpected package files");
}

export function resetStage(repo: string): string {
  const stage = safeBuildDirectory(repo, join(repo, "desktop/.bundle/runtime"));
  if (existsSync(stage)) rmSync(stage, { recursive: true });
  mkdirSync(stage, { recursive: true });
  return stage;
}
