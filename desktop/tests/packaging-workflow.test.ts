import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { packageVersions } from "../scripts/platform";

const repo = resolve(import.meta.dir, "../..");
test("macOS bundle keeps a PNG for Tauri's compiled default window/tray icon", () => {
  const config = JSON.parse(readFileSync(resolve(repo, "desktop/src-tauri/tauri.macos.bundle.conf.json"), "utf8"));
  // Tauri deletes the intermediate .app after DMG creation unless explicitly requested.
  // Retain it for the signature and actual bundled-runtime smoke checks.
  expect(config.bundle.targets).toEqual(["app", "dmg"]);
  const png = config.bundle.icon.find((icon: string) => icon.endsWith(".png"));
  expect(png).toBeDefined();
  expect(existsSync(resolve(repo, "desktop/src-tauri", png))).toBe(true);
});

test("desktop build metadata stays separate from the proxy release line", () => {
  const versions = packageVersions(repo);
  const config = JSON.parse(readFileSync(resolve(repo, "desktop/src-tauri/tauri.conf.json"), "utf8"));
  expect(resolve(repo, "desktop/src-tauri", config.version)).toBe(resolve(repo, "desktop/package.json"));
  const lock = Bun.TOML.parse(readFileSync(resolve(repo, "desktop/src-tauri/Cargo.lock"), "utf8")) as { package: { name: string; version: string }[] };
  expect(lock.package.find(pkg => pkg.name === "opencodex-desktop")?.version).toBe(versions.desktopVersion);
});

test("installer automation builds three native platforms and only version tags grant release writes", () => {
  const workflow = Bun.YAML.parse(readFileSync(resolve(repo, ".github/workflows/desktop-build.yml"), "utf8")) as any;
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(Object.keys(workflow.on).sort()).toEqual(["push", "workflow_dispatch"]);
  expect(workflow.defaults.run.shell).toBe("bash"); // Fail on intermediate command errors on Windows too.
  expect(workflow.jobs.build.strategy.matrix.include).toEqual([
    { platform: "win32-x64", runner: "windows-2022" },
    { platform: "darwin-arm64", runner: "macos-15" },
    { platform: "darwin-x64", runner: "macos-15-intel" },
  ]);
  expect(workflow.on.push.tags).toEqual(["desktop-v*"]);
  expect(workflow.jobs.build.permissions).toBeUndefined();
  expect(workflow.jobs["verify-release"].permissions).toBeUndefined();
  for (const job of Object.values(workflow.jobs) as any[]) {
    for (const step of job.steps) {
      if (step.uses && !step.uses.startsWith("./")) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
      if (step.uses?.startsWith("actions/checkout@")) expect(step.with["persist-credentials"]).toBe(false);
    }
  }
  expect(workflow.jobs.release.needs).toEqual(["build", "verify-release"]);
  expect(workflow.jobs.release.permissions).toEqual({ contents: "write" });
  expect(workflow.jobs.release.if).toBe("github.ref_type == 'tag' && startsWith(github.ref, 'refs/tags/desktop-v')");
  expect(workflow.jobs["verify-release"].needs).toBe("build");
  for (const job of [workflow.jobs["verify-release"], workflow.jobs.release]) {
    const download = job.steps.find((step: any) => step.uses?.startsWith("actions/download-artifact@"));
    expect(download.with["merge-multiple"]).toBe(false);
    expect(download.with.pattern).toBe("opencodex-desktop-*-${{ github.sha }}");
    expect(download.with["run-id"]).toBeUndefined();
    expect(job.steps.some((step: any) => step.run?.includes("install"))).toBe(false);
  }
  const upload = workflow.jobs.build.steps.find((step: any) => step.uses?.startsWith("actions/upload-artifact@"));
  expect(upload.with.path).toBe("desktop/.bundle/artifacts/");
  expect(upload.with["if-no-files-found"]).toBe("error");
  expect(workflow.jobs.build.steps.find((step: any) => step.uses?.startsWith("actions/checkout@")).with["persist-credentials"]).toBe(false);
});
