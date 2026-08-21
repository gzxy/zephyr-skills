#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
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
  "prepare-delivery.mjs",
);

function run(cwd, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.equal(
    result.status,
    0,
    `命令失败：${command} ${args.join(" ")}\n${output}`,
  );
  return output;
}

function runFailure(cwd, command, args) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.notEqual(result.status, 0, `命令本应失败：${command} ${args.join(" ")}`);
  return output;
}

function git(cwd, ...args) {
  return run(cwd, "git", args);
}

function gitOutput(cwd, ...args) {
  return git(cwd, ...args).trim();
}

function writeCheckpoint(repo, mode, requestId, feature) {
  const directory = join(repo, ".git", "pr-helper");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${mode}-${requestId}.json`),
    `${JSON.stringify(
      {
        mode,
        request_id: requestId,
        completed: ["preflight", "feature_synced"],
        feature_branch: feature,
      },
      null,
      2,
    )}\n`,
  );
}

function commitFile(repo, path, content, message) {
  writeFileSync(join(repo, path), content);
  git(repo, "add", path);
  git(repo, "commit", "-m", message);
}

function pushFeature(repo, feature) {
  git(repo, "push", "-u", "origin", feature);
}

function prepare(repo, mode, requestId, extraArgs = [], options = {}) {
  return run(
    repo,
    process.execPath,
    [
      script,
      "--mode",
      mode,
      "--request-id",
      requestId,
      ...extraArgs,
    ],
    options,
  );
}

function prepareFailure(repo, mode, requestId, extraArgs = []) {
  return runFailure(repo, process.execPath, [
    script,
    "--mode",
    mode,
    "--request-id",
    requestId,
    ...extraArgs,
  ]);
}

function assertAncestor(repo, ancestor, descendant) {
  git(repo, "merge-base", "--is-ancestor", ancestor, descendant);
}

function createRequirementBranch(repo, requestId, feature) {
  git(repo, "switch", "master");
  git(repo, "switch", "-c", feature);
  commitFile(repo, `feature-${requestId}.txt`, "v1\n", `feat: ${requestId} v1`);
  pushFeature(repo, feature);
  return feature;
}

function updateRemoteFeature(root, remote, requestId, feature) {
  const writer = join(root, `writer-${requestId}`);
  git(root, "clone", remote, writer);
  git(writer, "config", "user.name", "PR Helper Remote Test");
  git(writer, "config", "user.email", "pr-helper-remote@example.com");
  git(writer, "switch", feature);
  commitFile(
    writer,
    `feature-${requestId}.txt`,
    "v2\n",
    `feat: ${requestId} v2`,
  );
  git(writer, "push", "origin", feature);
}

function createLoggingGit(root) {
  const lookup = spawnSync("which", ["git"], { encoding: "utf8" });
  assert.equal(lookup.status, 0, lookup.stderr);
  const realGit = lookup.stdout.trim();
  const bin = join(root, "logging-git-bin");
  const log = join(root, "prepare-git-commands.log");
  const wrapper = join(bin, "git");
  mkdirSync(bin);
  writeFileSync(
    wrapper,
    "#!/bin/sh\n" +
      "printf '%s\\n' \"$*\" >> \"$PR_HELPER_GIT_LOG\"\n" +
      `exec ${JSON.stringify(realGit)} \"$@\"\n`,
  );
  chmodSync(wrapper, 0o755);
  return {
    log,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      PR_HELPER_GIT_LOG: log,
    },
  };
}

function assertFetchedRefsAvoidPull(trace) {
  const commands = trace.split(/\r?\n/).filter(Boolean);
  assert.equal(
    commands.filter((command) => command === "fetch origin").length,
    1,
  );
  assert.equal(
    commands.some((command) => command.startsWith("merge --ff-only origin/")),
    true,
  );
  assert.equal(
    commands.some((command) => command === "pull" || command.startsWith("pull ")),
    false,
  );
}

function testDelivery(root, remote, repo, loggingGit) {
  const requestId = "1001";
  const feature = `bugfix/demo/${requestId}-hotfix2`;
  createRequirementBranch(repo, requestId, feature);
  const temporary = `tmp_feature/demo/${requestId}-hotfix2`;
  writeCheckpoint(repo, "test", requestId, feature);
  writeFileSync(loggingGit.log, "");
  prepare(repo, "test", requestId, [], { env: loggingGit.env });
  assertFetchedRefsAvoidPull(readFileSync(loggingGit.log, "utf8"));

  updateRemoteFeature(root, remote, requestId, feature);
  const output = prepare(repo, "test", requestId);
  assert.match(output, /需求分支已更新/);
  assert.match(output, /检查点失效，将重新执行该阶段/);
  assert.equal(
    gitOutput(repo, "rev-parse", feature),
    gitOutput(repo, "rev-parse", `origin/${feature}`),
  );
  assertAncestor(repo, `origin/${feature}`, `origin/${temporary}`);

  const before = gitOutput(repo, "rev-parse", `origin/${temporary}`);
  const repeated = prepare(repo, "test", requestId);
  const after = gitOutput(repo, "rev-parse", `origin/${temporary}`);
  assert.match(repeated, /跳过已完成阶段：test_branch_pushed/);
  assert.equal(after, before);
}

function releaseDelivery(root, remote, repo, loggingGit) {
  const requestId = "2002";
  const feature = `feature/demo/guild/${requestId}-v2`;
  createRequirementBranch(repo, requestId, feature);
  const release = `release/demo/20000201/${requestId}`;
  const temporary = `tmp_${release}`;
  git(repo, "push", "origin", `master:release/demo/20000101/${requestId}`);
  git(repo, "push", "origin", `master:${release}`);
  writeCheckpoint(repo, "release", requestId, feature);
  writeFileSync(loggingGit.log, "");
  const first = prepare(repo, "release", requestId, [], {
    env: loggingGit.env,
  });
  assertFetchedRefsAvoidPull(readFileSync(loggingGit.log, "utf8"));
  assert.match(first, new RegExp(`复用已有 release 分支：${release}`));
  assertAncestor(repo, `origin/${feature}`, `origin/${release}`);
  assertAncestor(repo, `origin/${release}`, `origin/${temporary}`);

  updateRemoteFeature(root, remote, requestId, feature);
  const output = prepare(repo, "release", requestId);
  assert.match(output, /需求分支已更新/);
  assert.match(output, /origin\/release\/demo\/20000201\/2002 未包含/);
  assert.doesNotMatch(output, /跳过已完成阶段：prerelease_branch_pushed/);
  assert.equal(
    gitOutput(repo, "rev-parse", feature),
    gitOutput(repo, "rev-parse", `origin/${feature}`),
  );
  assertAncestor(repo, `origin/${feature}`, `origin/${release}`);
  assertAncestor(repo, `origin/${release}`, `origin/${temporary}`);

  const date = new Date();
  const today =
    String(date.getFullYear()) +
    String(date.getMonth() + 1).padStart(2, "0") +
    String(date.getDate()).padStart(2, "0");
  const newRelease = `release/demo/${today}/${requestId}`;
  const newTemporary = `tmp_${newRelease}`;
  const renewed = prepare(repo, "release", requestId, [
    "--new-release-date",
  ]);
  assert.match(renewed, new RegExp(`将创建 release 分支：${newRelease}`));
  assertAncestor(repo, `origin/${feature}`, `origin/${newRelease}`);
  assertAncestor(repo, `origin/${newRelease}`, `origin/${newTemporary}`);
}

function conflictDelivery(repo) {
  const requestId = "3003";
  const feature = `feature/demo/${requestId}`;
  const temporary = `tmp_feature/demo/${requestId}`;
  const conflictPath = `conflict-${requestId}.txt`;

  git(repo, "switch", "test");
  commitFile(
    repo,
    conflictPath,
    "test version\n",
    "test: add conflicting file",
  );
  git(repo, "push", "origin", "test");

  git(repo, "switch", "master");
  git(repo, "switch", "-c", feature);
  commitFile(
    repo,
    conflictPath,
    "feature version\n",
    "feat: add conflicting file",
  );
  pushFeature(repo, feature);
  writeCheckpoint(repo, "test", requestId, feature);

  const firstOutput = prepareFailure(repo, "test", requestId);
  assert.match(firstOutput, /冲突现场已保留；流程已停止/);
  assert.match(firstOutput, new RegExp(`冲突文件：\\n- ${conflictPath}`));
  assert.match(firstOutput, /处理建议：/);
  assert.match(firstOutput, /git status --short/);
  assert.match(firstOutput, /git add -- <冲突文件路径>/);
  assert.match(firstOutput, /git diff --cached --check/);
  assert.match(firstOutput, /git diff --name-only --diff-filter=U/);
  assert.match(firstOutput, /git commit/);
  assert.match(firstOutput, /重新运行本次 prepare-delivery 命令/);
  assert.match(firstOutput, /不会自动解决、自动提交或执行 `git merge --abort`/);
  assert.equal(gitOutput(repo, "branch", "--show-current"), temporary);
  assert.notEqual(gitOutput(repo, "rev-parse", "--verify", "MERGE_HEAD"), "");

  const checkpoint = JSON.parse(
    readFileSync(
      join(repo, ".git", "pr-helper", `test-${requestId}.json`),
      "utf8",
    ),
  );
  assert.equal(checkpoint.stage, "test_branch_pushed:conflict");
  assert.deepEqual(checkpoint.conflicts, [conflictPath]);

  const retryOutput = prepareFailure(repo, "test", requestId);
  assert.match(retryOutput, /仓库中已有进行中的 merge/);
  assert.match(retryOutput, new RegExp(`冲突文件：\\n- ${conflictPath}`));
  assert.match(retryOutput, /处理建议：/);
  assert.notEqual(gitOutput(repo, "rev-parse", "--verify", "MERGE_HEAD"), "");
}

const root = mkdtempSync(join(tmpdir(), "pr-helper-delivery-"));
const remote = join(root, "origin.git");
const repo = join(root, "repo");

try {
  const loggingGit = createLoggingGit(root);
  mkdirSync(repo);
  git(root, "init", "--bare", remote);
  git(repo, "init", "-b", "master");
  git(repo, "config", "user.name", "PR Helper Test");
  git(repo, "config", "user.email", "pr-helper@example.com");
  commitFile(repo, "README.md", "initial\n", "chore: initial");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-u", "origin", "master");
  git(repo, "push", "origin", "master:test", "master:pre_release");
  git(repo, "fetch", "origin");

  testDelivery(root, remote, repo, loggingGit);
  releaseDelivery(root, remote, repo, loggingGit);
  conflictDelivery(repo);
  console.log("prepare-delivery 转测、提单与冲突处理建议回归测试通过。");
} finally {
  rmSync(root, { recursive: true, force: true });
}
