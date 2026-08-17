#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const MANIFEST_PATH = join(REPO_ROOT, "lazycat", "lzc-manifest.yml");

export type ComponentName = "news-api" | "annotation-web" | "label-web";

export interface ReleaseState {
  appVersion: string;
  components: Record<ComponentName, string>;
}

const IMAGE_COMPONENTS: Array<{ component: ComponentName; imageName: string }> = [
  { component: "news-api", imageName: "quote0-mcp-api" },
  { component: "annotation-web", imageName: "quote0-annotation-web" },
  { component: "label-web", imageName: "quote0-label-web" },
];

export function parseSemver(version: string): [number, number, number] | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSemver(a: string, b: string): number {
  const av = parseSemver(a);
  const bv = parseSemver(b);
  if (!av || !bv) throw new Error(`invalid semver comparison: ${a} vs ${b}`);
  for (let index = 0; index < 3; index += 1) {
    if (av[index] !== bv[index]) return av[index] - bv[index];
  }
  return 0;
}

export function parseReleaseManifest(text: string): ReleaseState {
  const appVersionMatch = text.match(/^version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$/m);
  if (!appVersionMatch) {
    throw new Error("lazycat/lzc-manifest.yml 缺少合法的顶层 SemVer version");
  }

  let buildBranch: "none" | "dev" | "prod" = "none";
  const components = {} as Partial<Record<ComponentName, string>>;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "#@build if env.DEV_MODE=1") {
      buildBranch = "dev";
      continue;
    }
    if (line === "#@build else") {
      buildBranch = "prod";
      continue;
    }
    if (line === "#@build end") {
      buildBranch = "none";
      continue;
    }
    if (buildBranch !== "prod") continue;

    const imageMatch = line.match(/^image:\s*(\S+)/);
    if (!imageMatch) continue;

    for (const { component, imageName } of IMAGE_COMPONENTS) {
      const versionMatch = imageMatch[1].match(new RegExp(`/${imageName}:v(\\d+\\.\\d+\\.\\d+)$`));
      if (versionMatch) components[component] = versionMatch[1];
    }
  }

  for (const { component } of IMAGE_COMPONENTS) {
    if (!components[component]) {
      throw new Error(`无法从 production build 分支解析 ${component} 的版本镜像`);
    }
  }

  return {
    appVersion: appVersionMatch[1],
    components: components as Record<ComponentName, string>,
  };
}

export function validateReleaseState(state: ReleaseState): string[] {
  const errors: string[] = [];
  const appVersion = parseSemver(state.appVersion);
  if (!appVersion) errors.push(`应用版本不是 SemVer: ${state.appVersion}`);

  let ownerCount = 0;
  for (const [component, version] of Object.entries(state.components) as Array<[ComponentName, string]>) {
    if (!parseSemver(version)) {
      errors.push(`${component} 镜像版本不是 SemVer: ${version}`);
      continue;
    }
    const comparison = compareSemver(version, state.appVersion);
    if (comparison > 0) {
      errors.push(`${component} v${version} 超前于应用 release envelope v${state.appVersion}`);
    }
    if (comparison === 0) ownerCount += 1;
  }

  if (ownerCount === 0) {
    errors.push(`v${state.appVersion} 没有任何 production 自建镜像使用同版本，疑似 ghost release`);
  }

  return errors;
}

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function refExists(ref: string): boolean {
  return git(["show-ref", "--verify", "--hash", ref]) !== null;
}

function isAncestor(ancestor: string, descendant: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function shortSha(ref: string): string {
  return git(["rev-parse", "--short=12", ref]) ?? "unknown";
}

function main() {
  const requireRemote = process.argv.includes("--require-remote");
  const requireReleaseRef = requireRemote || process.argv.includes("--require-release-ref");
  const manifest = readFileSync(MANIFEST_PATH, "utf8");
  const state = parseReleaseManifest(manifest);
  const errors = validateReleaseState(state);
  const warnings: string[] = [];

  const localReleaseRef = `refs/heads/release/v${state.appVersion}`;
  const remoteReleaseRef = `refs/remotes/origin/release/v${state.appVersion}`;
  const hasLocalReleaseRef = refExists(localReleaseRef);
  const hasRemoteReleaseRef = refExists(remoteReleaseRef);
  const headSha = git(["rev-parse", "HEAD"]);
  const localReleaseSha = hasLocalReleaseRef ? git(["rev-parse", localReleaseRef]) : null;
  const remoteReleaseSha = hasRemoteReleaseRef ? git(["rev-parse", remoteReleaseRef]) : null;
  const localReleaseExact = Boolean(headSha && localReleaseSha === headSha);
  const remoteReleaseExact = Boolean(headSha && remoteReleaseSha === headSha);
  const hasExactReleaseRef = localReleaseExact || remoteReleaseExact;

  if (!hasExactReleaseRef) {
    const message = `当前 HEAD 尚无精确 release/v${state.appVersion} ref；pre-release 阶段允许，发布快照阶段必须补齐`;
    if (requireReleaseRef) errors.push(message);
    else warnings.push(message);
  }

  const clean = (git(["status", "--porcelain"]) ?? "").length === 0;
  if (!clean) warnings.push("工作区存在未提交改动；它们不属于当前 release commit 的可复现源码");

  const remoteMainContainsHead = refExists("refs/remotes/origin/main") && isAncestor("HEAD", "origin/main");
  let liveRemoteReleaseExact = remoteReleaseExact;
  if (requireRemote) {
    const remoteLine = git(["ls-remote", "--heads", "origin", `release/v${state.appVersion}`]);
    const liveRemoteSha = remoteLine?.split(/\s+/)[0] ?? null;
    liveRemoteReleaseExact = Boolean(headSha && liveRemoteSha === headSha);
  }
  const representedRemotely = liveRemoteReleaseExact || remoteMainContainsHead;

  if (!representedRemotely) {
    warnings.push(`HEAD ${shortSha("HEAD")} 尚未被 origin/main 或 origin/release/v${state.appVersion} 收录`);
  }

  if (requireReleaseRef && !clean) {
    errors.push(`${requireRemote ? "--require-remote" : "--require-release-ref"} 要求工作区干净`);
  }
  if (requireRemote && !liveRemoteReleaseExact) {
    errors.push(`--require-remote 要求远端 release/v${state.appVersion} 实时精确指向当前 HEAD`);
  }

  const owners = (Object.entries(state.components) as Array<[ComponentName, string]>)
    .filter(([, version]) => version === state.appVersion)
    .map(([component]) => component);

  console.log(`Quote0 release envelope: v${state.appVersion}`);
  console.log(`HEAD: ${shortSha("HEAD")}`);
  console.log(`release owner: ${owners.join(", ") || "none"}`);
  console.log("component matrix:");
  for (const [component, version] of Object.entries(state.components) as Array<[ComponentName, string]>) {
    const marker = version === state.appVersion ? "current" : "pinned";
    console.log(`  - ${component.padEnd(15)} v${version} (${marker})`);
  }
  console.log(`release ref: ${localReleaseExact ? `release/v${state.appVersion} (local exact)` : remoteReleaseExact ? `origin/release/v${state.appVersion} (remote exact)` : "not exact at HEAD"}`);
  console.log(`remote represented: ${representedRemotely ? "yes" : "no"}`);
  console.log(`working tree: ${clean ? "clean" : "dirty"}`);

  for (const warning of warnings) console.warn(`⚠️  ${warning}`);
  if (errors.length > 0) {
    for (const error of errors) console.error(`❌ ${error}`);
    process.exit(1);
  }

  const gateName = requireRemote ? "remote release" : requireReleaseRef ? "release-ref" : "pre-release";
  console.log(`✅ ${gateName} governance gate passed`);
}

if (import.meta.main) main();
