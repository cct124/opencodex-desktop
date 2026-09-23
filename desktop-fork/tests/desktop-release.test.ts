import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { releaseVersion, verifyArtifacts, publishRelease } = createRequire(import.meta.url)("../../.github/scripts/desktop-release.cjs");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const sha = "a".repeat(40);
const ref = "refs/tags/desktop-v0.1.1";
const platforms = ["win32-x64", "darwin-arm64", "darwin-x64"];
const digest = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), "desktop-release-"));
  roots.push(repo);
  mkdirSync(join(repo, "desktop-fork/src-tauri"), { recursive: true });
  mkdirSync(join(repo, "desktop-fork/releases"));
  writeFileSync(join(repo, "desktop-fork/package.json"), JSON.stringify({ version: "0.1.1" }));
  writeFileSync(join(repo, "desktop-fork/src-tauri/Cargo.toml"), '[package]\nname = "opencodex-desktop"\nversion = "0.1.1"\n[dependencies]\n');
  writeFileSync(join(repo, "package.json"), JSON.stringify({ version: "2.50.0", dependencies: { bun: "1.4.2" } }));
  writeFileSync(join(repo, "desktop-fork/releases/0.1.1.md"), "Desktop preview notes\n");
  const directory = join(repo, "artifacts");
  for (const platform of platforms) {
    const folder = join(directory, `opencodex-desktop-${platform}-${sha}`);
    mkdirSync(folder, { recursive: true });
    const suffix = platform === "win32-x64" ? "x64-setup.exe" : platform === "darwin-arm64" ? "aarch64.dmg" : "x64.dmg";
    const installer = `OpenCodex Desktop_0.1.1_${suffix}`;
    const data = `fixture installer ${platform}`;
    writeFileSync(join(folder, installer), data);
    writeFileSync(join(folder, `${installer}.sha256`), `${digest(data)}  ${installer}\n`);
    writeFileSync(join(folder, "build-info.json"), JSON.stringify({ desktopVersion: "0.1.1", runtimeVersion: "2.50.0", bunVersion: "1.4.2", platform, commit: sha, installer, sha256: digest(data) }));
  }
  return { repoRoot: repo, directory, folder: join(directory, `opencodex-desktop-win32-x64-${sha}`) };
}

function fakeGitHub() {
  const state = { release: null as any, assets: [] as any[], writes: [] as string[], nextId: 1, uploadAttempts: 0, failUploadAt: 0, tagReads: 0, moveTagAt: 0 };
  const repos = {
    listReleases: Symbol("releases"), listReleaseAssets: Symbol("assets"),
    async createRelease(args: any) {
      state.writes.push("create-draft");
      expect(args.draft).toBe(true);
      state.release = { ...args, id: 1, html_url: "https://github.com/example/desktop/releases/tag/desktop-v0.1.1" };
      return { data: state.release };
    },
    async uploadReleaseAsset(args: any) {
      state.uploadAttempts++;
      if (state.uploadAttempts === state.failUploadAt) throw new Error("Simulated upload interruption");
      state.writes.push("upload");
      state.assets.push({ id: state.nextId++, name: args.name, size: args.data.length, state: "uploaded", digest: `sha256:${digest(args.data)}` });
      return { data: state.assets.at(-1) };
    },
    async deleteReleaseAsset(args: any) { state.writes.push("delete"); state.assets = state.assets.filter(asset => asset.id !== args.asset_id); },
    async updateRelease(args: any) {
      expect(state.assets).toHaveLength(9);
      expect(state.tagReads).toBeGreaterThanOrEqual(2);
      state.writes.push("publish");
      Object.assign(state.release, args);
      return { data: state.release };
    },
  };
  const github = { rest: { repos, git: { async getRef() {
    state.tagReads++;
    return { data: { object: { type: "commit", sha: state.tagReads === state.moveTagAt ? "b".repeat(40) : sha } } };
  } } }, async paginate(method: symbol) { return method === repos.listReleases ? state.release ? [state.release] : [] : state.assets; } };
  return { github, state, context: { eventName: "push", ref, sha, repo: { owner: "example", repo: "desktop" } } };
}

test("release tags must name the independent desktop version", () => {
  const { repoRoot } = fixture();
  expect(releaseVersion(repoRoot, ref).tag).toBe("desktop-v0.1.1");
  expect(releaseVersion(repoRoot, "refs/heads/dev").tag).toBe("desktop-v0.1.1");
  for (const tag of ["refs/tags/v2.50.0", "refs/tags/desktop-v0.1.0", "refs/tags/desktop-v0.1.1-test", "refs/tags/desktop-v0.1.1\n"]) {
    expect(() => releaseVersion(repoRoot, tag)).toThrow();
  }
});

test("release verification collects three installers and gives checksums and metadata unique portable names", () => {
  const f = fixture();
  const plan = verifyArtifacts(f.repoRoot, f.directory, sha, ref);
  expect(plan.assets).toHaveLength(9);
  expect(new Set(plan.assets.map((asset: any) => asset.name)).size).toBe(9);
  for (const asset of plan.assets) {
    expect(asset.name).not.toContain(" ");
    if (asset.name.endsWith(".sha256")) expect(asset.data.toString()).toContain(asset.name.slice(0, -7));
    if (asset.name.endsWith(".json")) expect(JSON.parse(asset.data).installer).toStartWith("OpenCodex-Desktop_");
  }
});

test("mismatched, incomplete or modified artifacts fail before any release write", async () => {
  for (const failure of ["missing-platform", "wrong-commit", "wrong-version", "modified-installer", "extra-file", "missing-notes"]) {
    const f = fixture();
    const infoPath = join(f.folder, "build-info.json");
    const info = JSON.parse(readFileSync(infoPath, "utf8"));
    if (failure === "missing-platform") rmSync(f.folder, { recursive: true });
    if (failure === "wrong-commit" || failure === "wrong-version") {
      if (failure === "wrong-commit") info.commit = "b".repeat(40); else info.desktopVersion = "0.1.0";
      writeFileSync(infoPath, JSON.stringify(info));
    }
    if (failure === "modified-installer") writeFileSync(join(f.folder, info.installer), "replacement");
    if (failure === "extra-file") writeFileSync(join(f.folder, "unexpected.txt"), "extra");
    if (failure === "missing-notes") rmSync(join(f.repoRoot, "desktop-fork/releases/0.1.1.md"));
    const api = fakeGitHub();
    await expect(publishRelease({ ...f, ...api })).rejects.toThrow();
    expect(api.state.writes).toEqual([]);
  }
});

test("publication waits for all verified assets and reruns preserve the public release", async () => {
  const f = fixture(); const api = fakeGitHub();
  const url = await publishRelease({ ...f, ...api });
  expect(url).toContain("desktop-v0.1.1");
  expect(api.state.writes).toEqual(["create-draft", ...Array(9).fill("upload"), "publish"]);
  expect(api.state.release).toMatchObject({ prerelease: true, draft: false, make_latest: "false", target_commitish: sha });
  const writes = [...api.state.writes];
  await publishRelease({ ...f, ...api });
  expect(api.state.writes).toEqual(writes);
});

test("an interrupted upload keeps a private draft and resumes without replacing matching assets", async () => {
  const f = fixture(); const api = fakeGitHub(); api.state.failUploadAt = 3;
  await expect(publishRelease({ ...f, ...api })).rejects.toThrow("interruption");
  expect(api.state.release.draft).toBe(true);
  expect(api.state.assets).toHaveLength(2);
  await publishRelease({ ...f, ...api });
  expect(api.state.release.draft).toBe(false);
  expect(api.state.writes.filter(write => write === "upload")).toHaveLength(9);
  expect(api.state.writes).not.toContain("delete");
});

test("foreign releases, moved tags, and branch events cannot publish", async () => {
  const f = fixture();
  const foreign = fakeGitHub();
  foreign.state.release = { tag_name: "desktop-v0.1.1", target_commitish: sha, body: "human release", draft: false };
  await expect(publishRelease({ ...f, ...foreign })).rejects.toThrow("preserved");
  expect(foreign.state.writes).toEqual([]);
  const moved = fakeGitHub(); moved.state.moveTagAt = 2;
  await expect(publishRelease({ ...f, ...moved })).rejects.toThrow("Remote tag moved");
  expect(moved.state.release.draft).toBe(true);
  const branch = fakeGitHub(); branch.context.ref = "refs/heads/desktop-v0.1.1";
  await expect(publishRelease({ ...f, ...branch })).rejects.toThrow("Only desktop version tags");
  expect(branch.state.writes).toEqual([]);
});
