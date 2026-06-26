#!/usr/bin/env bunx tsx
/**
 * Preflight 守卫：base 镜像必须 digest 钉死（@sha256:），禁止裸 tag。
 *
 * 背景（2026-06-26 三连环故障根因）：
 *   dev.logic.heiyu.space 是扁平、跨所有 app 共享、可写、无不可变 tag 的 Docker registry。
 *   2026-06-25 一次 vision-hub 部署把 node 镜像 push 覆盖了共享 tag library/redis:7-alpine
 *   与 minio/minio:latest → quote0 / skilladder 的 redis/minio 容器随后重建即崩。
 *   根治 = 消费侧按「内容身份」而非「可变名字」引用：digest 钉死，Docker pull 时密码学校验，
 *   被覆盖的污染镜像哈希对不上、物理上替换不进来。详见 lzc-manifest.yml 各 base 镜像注释。
 *
 * 规则：manifest 里凡是「非本应用自建」的镜像（base/外部镜像），其 image 必须含 @sha256:。
 *   本应用自建镜像（每次部署新构建、版本 tag）豁免。
 *
 * 退出码：0 = 全部合规；1 = 发现裸 tag 的 base 镜像。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(__dirname, "..", "lazycat", "lzc-manifest.yml");

// 本应用自建镜像（豁免 digest 要求）——这些每次部署都新构建并打版本号 tag
const SELF_BUILT = [
  "quote0-mcp-api",
  "quote0-label-web",
  "quote0-annotation-web",
];

function isSelfBuilt(image: string): boolean {
  return SELF_BUILT.some((name) => image.includes(`/${name}:`) || image.includes(`/${name}@`));
}

function main() {
  const text = readFileSync(MANIFEST, "utf8");
  const violations: { line: number; image: string }[] = [];

  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith("#")) return;
    const m = line.match(/^image:\s*(\S+)/);
    if (!m) return;
    const image = m[1];
    if (image.startsWith("embed:")) return; // LPK v2 内嵌镜像，天然自包含，豁免
    if (isSelfBuilt(image)) return;
    if (!image.includes("@sha256:")) {
      violations.push({ line: i + 1, image });
    }
  });

  if (violations.length === 0) {
    console.log("✅ base 镜像守卫通过：所有外部/base 镜像均已 digest 钉死");
    process.exit(0);
  }

  console.error("❌ base 镜像守卫失败：以下 base 镜像用了裸 tag，必须改成 @sha256: digest 钉死");
  console.error("   原因见 scripts/check-manifest-base-images.ts 头部注释（2026-06 共享 registry tag 污染故障）");
  for (const v of violations) {
    console.error(`   lzc-manifest.yml:${v.line}  ${v.image}`);
  }
  console.error("\n   取 digest：docker image inspect <image> --format '{{index .RepoDigests 0}}'");
  process.exit(1);
}

main();
