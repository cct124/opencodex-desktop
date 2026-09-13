const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const platforms = ['win32-x64', 'darwin-arm64', 'darwin-x64'];
const digest = data => createHash('sha256').update(data).digest('hex');
function check(value, message) { if (!value) throw new Error(message); }
function readFile(file) {
  const stat = fs.lstatSync(file);
  check(stat.isFile() && !stat.isSymbolicLink(), 'Release inputs must be ordinary files');
  return fs.readFileSync(file);
}

function releaseVersion(repo, ref) {
  const desktop = JSON.parse(readFile(path.join(repo, 'desktop/package.json')));
  const runtime = JSON.parse(readFile(path.join(repo, 'package.json')));
  const cargo = readFile(path.join(repo, 'desktop/src-tauri/Cargo.toml')).toString();
  const pkg = cargo.match(/\[package\]([\s\S]*?)(?=\n\[|$)/)?.[1];
  check(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(desktop.version), 'Invalid desktop version');
  check(pkg?.match(/^version\s*=\s*"([^"]+)"/m)?.[1] === desktop.version, 'Desktop and Cargo versions differ');
  const tag = `desktop-v${desktop.version}`;
  check(typeof ref === 'string' && (ref.startsWith('refs/heads/') || ref === `refs/tags/${tag}`), 'Release tag must match the desktop version exactly');
  return { tag, desktopVersion: desktop.version, runtimeVersion: runtime.version, bunVersion: runtime.dependencies.bun };
}

function verifyArtifacts(repo, directory, sha, ref) {
  check(/^[a-f0-9]{40}$/.test(sha), 'Expected an exact build commit');
  const versions = releaseVersion(repo, ref);
  const expectedDirectories = platforms.map(platform => `opencodex-desktop-${platform}-${sha}`).sort();
  check(JSON.stringify(fs.readdirSync(directory).sort()) === JSON.stringify(expectedDirectories), 'Expected exactly three platform artifacts from this commit');
  const assets = [];
  for (const platform of platforms) {
    const folder = path.join(directory, `opencodex-desktop-${platform}-${sha}`);
    check(fs.lstatSync(folder).isDirectory() && !fs.lstatSync(folder).isSymbolicLink(), 'Invalid artifact directory');
    const suffix = platform === 'win32-x64' ? 'x64-setup.exe' : platform === 'darwin-arm64' ? 'aarch64.dmg' : 'x64.dmg';
    const filename = `OpenCodex Desktop_${versions.desktopVersion}_${suffix}`;
    check(JSON.stringify(fs.readdirSync(folder).sort()) === JSON.stringify([filename, `${filename}.sha256`, 'build-info.json'].sort()), 'Unexpected or missing artifact files');
    const info = JSON.parse(readFile(path.join(folder, 'build-info.json')));
    for (const field of ['desktopVersion', 'runtimeVersion', 'bunVersion']) check(info[field] === versions[field], `Artifact ${field} mismatch`);
    check(info.commit === sha && info.platform === platform && info.installer === filename, 'Artifact provenance mismatch');
    const data = readFile(path.join(folder, filename));
    const sha256 = digest(data);
    check(data.length > 0 && info.sha256 === sha256, 'Installer checksum mismatch');
    check(readFile(path.join(folder, `${filename}.sha256`)).toString().trim() === `${sha256}  ${filename}`, 'Checksum file mismatch');
    // GitHub normalizes special characters in asset names. Publish portable names
    // and matching checksum/metadata files instead of relying on that rewriting.
    const name = filename.replace('OpenCodex Desktop', 'OpenCodex-Desktop');
    assets.push({ name, data });
    assets.push({ name: `${name}.sha256`, data: Buffer.from(`${sha256}  ${name}\n`) });
    assets.push({ name: `build-info-${platform}.json`, data: Buffer.from(JSON.stringify({ ...info, installer: name }, null, 2) + '\n') });
  }
  const notes = readFile(path.join(repo, 'desktop/releases', `${versions.desktopVersion}.md`)).toString().trim();
  check(notes.length > 0, 'Add desktop release notes before publishing');
  return { ...versions, sha, assets: assets.map(asset => ({ ...asset, digest: `sha256:${digest(asset.data)}` })), notes };
}

async function assertRemoteTag(github, repo, tag, sha) {
  let { data: { object } } = await github.rest.git.getRef({ ...repo, ref: `tags/${tag}` });
  for (let depth = 0; object.type === 'tag' && depth < 5; depth++) {
    ({ data: { object } } = await github.rest.git.getTag({ ...repo, tag_sha: object.sha }));
  }
  check(object.type === 'commit' && object.sha === sha, 'Remote tag moved or does not name this build commit');
}

async function publishRelease({ github, context, directory, repoRoot }) {
  check(['push', 'workflow_dispatch'].includes(context.eventName) && context.ref.startsWith('refs/tags/desktop-v'), 'Only desktop version tags may publish');
  const plan = verifyArtifacts(repoRoot, directory, context.sha, context.ref);
  const repo = context.repo;
  await assertRemoteTag(github, repo, plan.tag, plan.sha);
  const marker = `<!-- desktop-release:${plan.sha} -->`;
  const body = `${plan.notes}\n\nDesktop: ${plan.desktopVersion} · OpenCodex: ${plan.runtimeVersion} · Bun: ${plan.bunVersion}\n\nCommit: ${plan.sha}\n\n${marker}`;
  const releases = await github.paginate(github.rest.repos.listReleases, { ...repo, per_page: 100 });
  let release = releases.find(candidate => candidate.tag_name === plan.tag);
  if (release) {
    check(release.target_commitish === plan.sha && release.body?.includes(marker), 'Existing release was not created by this workflow for this commit; preserved');
  } else {
    ({ data: release } = await github.rest.repos.createRelease({ ...repo, tag_name: plan.tag, target_commitish: plan.sha,
      name: `OpenCodex Desktop ${plan.desktopVersion}`, body, draft: true, prerelease: true, make_latest: 'false' }));
  }
  const listAssets = () => github.paginate(github.rest.repos.listReleaseAssets, { ...repo, release_id: release.id, per_page: 100 });
  const existing = await listAssets();
  const names = plan.assets.map(asset => asset.name).sort();
  check(existing.every(asset => names.includes(asset.name)), 'Existing release has unexpected assets; preserved');
  if (!release.draft) {
    // Native rebuilds need not be byte-identical. A completed publication is final;
    // reruns never replace public binaries or reset a manually promoted release.
    check(JSON.stringify(existing.map(asset => asset.name).sort()) === JSON.stringify(names)
      && existing.every(asset => asset.state === 'uploaded' && asset.size > 0 && /^sha256:[a-f0-9]{64}$/.test(asset.digest)), 'Published release is incomplete; preserved for manual inspection');
    return release.html_url;
  }
  for (const asset of plan.assets) {
    const previous = existing.find(item => item.name === asset.name);
    if (previous?.state === 'uploaded' && previous.digest === asset.digest && previous.size === asset.data.length) continue;
    // Only our still-private draft can be repaired after a failed upload/rebuild.
    if (previous) await github.rest.repos.deleteReleaseAsset({ ...repo, asset_id: previous.id });
    await github.rest.repos.uploadReleaseAsset({ ...repo, release_id: release.id, name: asset.name,
      data: asset.data, headers: { 'content-type': 'application/octet-stream', 'content-length': asset.data.length } });
  }
  const uploaded = await listAssets();
  check(uploaded.length === plan.assets.length && plan.assets.every(asset => uploaded.some(item =>
    item.name === asset.name && item.state === 'uploaded' && item.size === asset.data.length && item.digest === asset.digest)), 'Release uploads did not verify; draft retained');
  await assertRemoteTag(github, repo, plan.tag, plan.sha);
  const { data: published } = await github.rest.repos.updateRelease({ ...repo, release_id: release.id,
    body, draft: false, prerelease: true, make_latest: 'false' });
  return published.html_url;
}

module.exports = { releaseVersion, verifyArtifacts, publishRelease };
if (require.main === module) {
  const [command, directory] = process.argv.slice(2);
  const repo = process.cwd();
  if (command === 'validate-ref') {
    console.log(JSON.stringify(releaseVersion(repo, process.env.GITHUB_REF)));
  } else if (command === 'verify-artifacts') {
    const result = verifyArtifacts(repo, directory, process.env.GITHUB_SHA, process.env.GITHUB_REF);
    console.log(JSON.stringify({ verified: true, tag: result.tag, commit: result.sha, assets: result.assets.map(asset => asset.name) }));
  } else throw new Error('Expected validate-ref or verify-artifacts');
}
