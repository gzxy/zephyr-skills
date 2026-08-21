#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePullRequestTemplate } from "../scripts/pull-request-template.mjs";

const root = mkdtempSync(join(tmpdir(), "pr-helper-template-"));

try {
  const fallback = resolvePullRequestTemplate(root);
  assert.equal(fallback.source, "fallback");
  assert.match(fallback.path, /references\/pull-request-template\.md$/);

  const projectPath = join(root, ".github", "PULL_REQUEST_TEMPLATE.md");
  mkdirSync(join(root, ".github"));
  writeFileSync(projectPath, "# 业务模板\n");
  const project = resolvePullRequestTemplate(root);
  assert.deepEqual(project, { path: projectPath, source: "project" });

  assert.throws(
    () =>
      resolvePullRequestTemplate(
        join(root, "missing-project"),
        join(root, "missing-template.md"),
      ),
    /业务仓库和 PR Helper 均未找到 PR 模板/,
  );

  console.log("PR 模板优先级与兜底逻辑回归测试通过。");
} finally {
  rmSync(root, { recursive: true, force: true });
}
