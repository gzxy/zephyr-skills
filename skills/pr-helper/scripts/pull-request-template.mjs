#!/usr/bin/env node
/** 解析业务仓库 PR 模板，并在缺失时使用 skill 内置兜底模板。 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fail } from "./common.mjs";

const defaultFallbackPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "references",
  "pull-request-template.md",
);

export function resolvePullRequestTemplate(
  root,
  fallbackPath = defaultFallbackPath,
) {
  const projectPath = join(root, ".github", "PULL_REQUEST_TEMPLATE.md");
  if (existsSync(projectPath)) {
    return { path: projectPath, source: "project" };
  }
  if (existsSync(fallbackPath)) {
    return { path: fallbackPath, source: "fallback" };
  }
  fail(
    `业务仓库和 PR Helper 均未找到 PR 模板：${projectPath}、${fallbackPath}`,
  );
}
