#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "build-pr-draft.mjs",
);

function run(cwd, command, args) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `命令失败：${command} ${args.join(" ")}\n` +
      `${result.stdout ?? ""}${result.stderr ?? ""}`,
  );
  return result;
}

function git(cwd, ...args) {
  return run(cwd, "git", args).stdout.trim();
}

function commit(repo, paths, message) {
  git(repo, "add", "--", ...paths);
  git(repo, "commit", "-m", message);
}

const root = mkdtempSync(join(tmpdir(), "pr-helper-draft-"));
const remote = join(root, "origin.git");
const repo = join(root, "repo");
const requestId = "4004";
const feature = `feature/demo/render/${requestId}`;
const head = `tmp_feature/demo/render/${requestId}`;

try {
  mkdirSync(repo);
  git(root, "init", "--bare", remote);
  git(repo, "init", "-b", "master");
  git(repo, "config", "user.name", "PR Helper Test");
  git(repo, "config", "user.email", "pr-helper@example.com");

  mkdirSync(join(repo, ".github"));
  writeFileSync(join(repo, "README.md"), "initial\n");
  writeFileSync(
    join(repo, ".github", "PULL_REQUEST_TEMPLATE.md"),
    "# 变更说明\n\n待填写\n\n" +
      "# 描述\n\n待填写\n\n" +
      "# 如何进行测试？\n\n待填写\n\n" +
      "# 影响\n\n待填写\n\n" +
      "# 清单\n\n- [ ] 已自测\n",
  );
  commit(
    repo,
    ["README.md", ".github/PULL_REQUEST_TEMPLATE.md"],
    "chore: initial",
  );
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-u", "origin", "master");
  git(repo, "push", "origin", "master:test");

  git(repo, "switch", "-c", feature);
  writeFileSync(join(repo, "feature.txt"), "rendering optimization\n");
  commit(
    repo,
    ["feature.txt"],
    "feat: reduce console output " +
      `--story=${requestId}@tapd-1 --user=Tester Rendering optimization ` +
      "https://example.com/story",
  );
  git(repo, "push", "-u", "origin", feature);

  git(repo, "switch", "-c", "test", "origin/test");
  git(repo, "switch", "-c", head);
  git(repo, "merge", "--no-edit", feature);
  git(repo, "push", "-u", "origin", head);

  const checkpointDir = join(repo, ".git", "pr-helper");
  mkdirSync(checkpointDir, { recursive: true });
  writeFileSync(
    join(checkpointDir, `test-${requestId}.json`),
    `${JSON.stringify(
      {
        mode: "test",
        request_id: requestId,
        completed: [
          "preflight",
          "feature_synced",
          "test_branch_pushed",
          "delivery_prepared",
        ],
        feature_branch: feature,
        head_branch: head,
        base_branch: "test",
      },
      null,
      2,
    )}\n`,
  );

  git(
    repo,
    "remote",
    "set-url",
    "origin",
    "https://github.com/example/pr-helper-test.git",
  );
  const built = run(repo, process.execPath, [
    script,
    "--mode",
    "test",
    "--request-id",
    requestId,
  ]);

  assert.ok(built.stdout.length < 1500, "控制台摘要不应包含超长 PR 正文");
  assert.doesNotMatch(built.stdout, /compare_url|quick_pull=1|associated_requirement/);
  const summary = JSON.parse(built.stdout);
  assert.equal(summary.title, "【测试】Rendering optimization");
  assert.equal(summary.base, "test");
  assert.equal(summary.head, head);
  assert.equal(summary.commit_count, 1);
  assert.equal(summary.current_branch, feature);
  assert.equal(summary.submitted, false);
  assert.equal(existsSync(summary.draft_path), true);
  assert.equal(existsSync(summary.result_path), true);

  const result = JSON.parse(readFileSync(summary.result_path, "utf8"));
  assert.ok(
    JSON.stringify(result, null, 2).length > built.stdout.length * 2,
    "完整结果应保存在文件中，而不是重复写入控制台摘要",
  );
  assert.equal(result.title, summary.title);
  assert.equal(result.result_path, summary.result_path);
  assert.match(
    result.compare_url,
    /^https:\/\/github\.com\/example\/pr-helper-test\/compare\/test\.\.\./,
  );
  assert.match(result.compare_url, /quick_pull=1&title=.*&body=/);
  assert.equal(result.commits.length, 1);
  assert.equal(result.commits[0].change, "reduce console output");
  assert.equal(result.current_branch, feature);

  const checkpoint = JSON.parse(readFileSync(summary.checkpoint, "utf8"));
  assert.equal(checkpoint.draft.result_path, summary.result_path);
  assert.equal(git(repo, "branch", "--show-current"), feature);

  const legacy = run(repo, process.execPath, [
    script,
    "--mode",
    "test",
    "--request-id",
    requestId,
    "--full-output",
  ]);
  const legacyResult = JSON.parse(legacy.stdout);
  assert.equal(legacyResult.compare_url, result.compare_url);
  assert.equal(legacyResult.commits.length, 1);
  assert.equal(legacyResult.result_path, summary.result_path);
  console.log("build-pr-draft 精简控制台输出与完整结果文件回归测试通过。");
} finally {
  rmSync(root, { recursive: true, force: true });
}
