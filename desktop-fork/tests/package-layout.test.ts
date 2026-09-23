import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyTree, removeDependencyBins, resetBuildDirectory, safeBuildDirectory, verifyManifest, writeManifest } from "../scripts/package-layout";
import { packagePlatform, packageVersions } from "../scripts/platform";

const versions = { desktopVersion: "0.1.0", runtimeVersion: "2.50.0", bunVersion: "1.4.2" };

test("package verification detects changed, injected and missing resources", () => {
  const root = mkdtempSync(join(tmpdir(), "ocx-package-"));
  try {
    writeFileSync(join(root, "entry.ts"), "original");
    writeManifest(root, versions);
    verifyManifest(root);
    writeFileSync(join(root, "entry.ts"), "modified");
    expect(() => verifyManifest(root)).toThrow("checksum mismatch");
    writeFileSync(join(root, "entry.ts"), "original");
    writeFileSync(join(root, ".env"), "injected");
    expect(() => verifyManifest(root)).toThrow("Unexpected");
    rmSync(join(root, ".env"));
    rmSync(join(root, "entry.ts"));
    expect(() => verifyManifest(root)).toThrow();
  } finally { rmSync(root, { recursive: true }); }
});

test("native platforms carry independent desktop/proxy versions and reject foreign resources", () => {
  const root = mkdtempSync(join(tmpdir(), "ocx-platform-"));
  try {
    writeFileSync(join(root, "entry.ts"), "fixture");
    for (const [os, arch, id, bun] of [["win32", "x64", "win32-x64", "bun.exe"], ["darwin", "arm64", "darwin-arm64", "bun"], ["darwin", "x64", "darwin-x64", "bun"]]) {
      expect(packagePlatform(os, arch)).toMatchObject({ id, bun });
      expect(writeManifest(root, versions, id)).toMatchObject(versions);
      verifyManifest(root, id);
      expect(() => verifyManifest(root, "wrong-platform")).toThrow("Invalid desktop manifest");
    }
    expect(() => packagePlatform("win32", "arm64")).toThrow("Unsupported");
    mkdirSync(join(root, "desktop-fork/src-tauri"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: versions.runtimeVersion, dependencies: { bun: versions.bunVersion } }));
    writeFileSync(join(root, "desktop-fork/package.json"), JSON.stringify({ version: versions.desktopVersion }));
    writeFileSync(join(root, "desktop-fork/src-tauri/Cargo.toml"), '[package]\nversion="0.1.0"');
    expect(packageVersions(root)).toEqual(versions);
    writeFileSync(join(root, "desktop-fork/src-tauri/Cargo.toml"), '[package]\nversion="0.2.0"');
    expect(() => packageVersions(root)).toThrow("matching");
  } finally { rmSync(root, { recursive: true }); }
});

test.skipIf(process.platform === "win32")("staging drops command symlinks, preserves executability, rejects other links", () => {
  const root = mkdtempSync(join(tmpdir(), "ocx-executable-"));
  try {
    const deps = join(root, "node_modules");
    mkdirSync(join(deps, ".bin"), { recursive: true });
    writeFileSync(join(deps, "bun"), "executable fixture");
    chmodSync(join(deps, "bun"), 0o755);
    symlinkSync("../bun", join(deps, ".bin/bun"));
    removeDependencyBins(deps);
    expect(existsSync(join(deps, ".bin"))).toBe(false);
    copyTree(deps, join(root, "copy"));
    expect(statSync(join(root, "copy/bun")).mode & 0o111).toBe(0o111);
    symlinkSync("bun", join(deps, "unapproved-link"));
    expect(() => copyTree(deps, join(root, "rejected"))).toThrow("link");
  } finally { rmSync(root, { recursive: true }); }
});

test("artifact collection clears obsolete versions without touching staged resources", () => {
  const root = mkdtempSync(join(tmpdir(), "ocx-artifacts-"));
  try {
    const stage = resetBuildDirectory(root, "runtime");
    writeFileSync(join(stage, "keep"), "runtime");
    const artifacts = resetBuildDirectory(root, "artifacts");
    writeFileSync(join(artifacts, "old.exe"), "obsolete");
    resetBuildDirectory(root, "artifacts");
    expect(existsSync(join(artifacts, "old.exe"))).toBe(false);
    expect(readFileSync(join(stage, "keep"), "utf8")).toBe("runtime");
  } finally { rmSync(root, { recursive: true }); }
});

test("staging cleanup refuses paths outside its fixed output", () => {
  const root = mkdtempSync(join(tmpdir(), "ocx-stage-"));
  try {
    mkdirSync(join(root, "desktop-fork"));
    expect(safeBuildDirectory(root, join(root, "desktop-fork/.bundle/runtime"))).toContain("runtime");
    for (const path of [root, join(root, "desktop-fork"), join(root, "desktop-fork/.bundle-other"), join(root, "desktop-fork/.bundle/../../src")]) {
      expect(() => safeBuildDirectory(root, path)).toThrow();
    }
  } finally { rmSync(root, { recursive: true }); }
});
