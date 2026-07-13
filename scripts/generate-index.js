#!/usr/bin/env node
/**
 * 生成 articles/index.json，基于已有的 index.json 为每篇文章补充 hash 字段。
 *
 * 用法: node scripts/generate-index.js [--strict]
 *
 * 流程:
 *   1. 读取现有 articles/index.json
 *   2. 遍历每个条目，找到对应的 .md 文件
 *   3. 校验每条记录的必需字段（slug/title/date/category/summary）
 *   4. 计算 .md 文件内容的 SHA256（完整 64 位）
 *   5. 校验 articles/ 下 .md 文件与 index.json 条目是否一一对应
 *   6. 将 hash 写回条目并写入 articles/index.json
 *
 * --strict 模式：任一项校验失败则抛出错误（供 CI 阻断发布）。
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function sha256(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function mdPath(articlesDir, slug) {
  return path.join(articlesDir, slug + ".md");
}

/** 必需字段；缺失视为无效条目 */
const REQUIRED_FIELDS = ["slug", "title", "date", "category", "summary"];

/**
 * 为给定仓库根目录下的 articles 重新生成 hash 并写回 index.json。
 * @param {string} rootDir 仓库根（含 articles/ 的目录）
 * @param {{strict?: boolean}} [opts]
 * @returns {{updated:number, invalid:number, inconsistent:number}}
 */
function runGenerate(rootDir, { strict = false } = {}) {
  const articlesDir = path.join(rootDir, "articles");
  const indexPath = path.join(articlesDir, "index.json");

  if (!fs.existsSync(indexPath)) {
    throw new Error(`index.json 不存在: ${indexPath}`);
  }

  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  let updated = 0;
  let invalid = 0;
  let inconsistent = 0;

  // 1) 校验每条记录字段 + 重算 hash
  for (const entry of index) {
    const missingFields = REQUIRED_FIELDS.filter((f) => {
      const v = entry[f];
      return v === undefined || v === null || v === "";
    });
    if (missingFields.length > 0) {
      invalid++;
      console.error(`  [错误] 条目缺少必需字段 ${missingFields.join("/")}: ${entry.slug ?? "<无 slug>"}`);
      continue;
    }

    const fp = mdPath(articlesDir, entry.slug);
    if (!fs.existsSync(fp)) {
      console.warn(`  [警告] 文件不存在，已跳过: ${entry.slug}.md`);
      inconsistent++;
      continue;
    }
    const content = fs.readFileSync(fp, "utf8");
    entry.hash = sha256(content);
    updated++;
  }

  // 2) 一致性检查：articles/ 下每个 .md 是否都有对应 index.json 条目
  const mdFiles = fs
    .readdirSync(articlesDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3)); // 去 .md
  const indexedSlugs = new Set(index.map((e) => e.slug).filter(Boolean));
  for (const slug of mdFiles) {
    if (!indexedSlugs.has(slug)) {
      inconsistent++;
      console.error(`  [错误] 存在无 index 条目的 .md 文件: ${slug}.md`);
    }
  }

  if (invalid > 0 || inconsistent > 0) {
    console.error(
      `内容校验失败：无效条目 ${invalid} 项，不一致 ${inconsistent} 处`,
    );
    if (strict) {
      throw new Error(`generate-index 校验未通过（invalid=${invalid}, inconsistent=${inconsistent}）`);
    }
  }

  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n", "utf8");
  console.log(
    `完成: ${updated} 篇文章已更新 hash，无效 ${invalid} 项，不一致 ${inconsistent} 处`,
  );
  return { updated, invalid, inconsistent };
}

module.exports = { runGenerate, sha256 };

// CLI 入口
if (require.main === module) {
  const ROOT = path.resolve(__dirname, "..");
  const strict = process.argv.includes("--strict");
  try {
    runGenerate(ROOT, { strict });
  } catch (e) {
    console.error("❌", e.message);
    process.exit(1);
  }
}
