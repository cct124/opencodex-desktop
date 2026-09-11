import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeBuildDirectory, verifyManifest, writeManifest } from "../scripts/package-layout";

test("package verification detects changed, injected and missing resources", () => {
  const root = mkdtempSync(join(tmpdir(), "ocx-package-"));
  try {
    writeFileSync(join(root, "entry.ts"), "original");
    writeManifest(root, "2.50.0", "1.4.2");
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

test("staging cleanup refuses paths outside its fixed output", () => {
  const root = mkdtempSync(join(tmpdir(), "ocx-stage-"));
  try {
    mkdirSync(join(root, "desktop"));
    expect(safeBuildDirectory(root, join(root, "desktop/.bundle/runtime"))).toContain("runtime");
    for (const path of [root, join(root, "desktop"), join(root, "desktop/.bundle-other"), join(root, "desktop/.bundle/../../src")]) {
      expect(() => safeBuildDirectory(root, path)).toThrow();
    }
  } finally { rmSync(root, { recursive: true }); }
});
