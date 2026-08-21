#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
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
  "preflight.mjs",
);
const syncScript = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "sync-feature.mjs",
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

function runFailure(cwd, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.notEqual(result.status, 0, `命令本应失败：${command} ${args.join(" ")}`);
  return output;
}

function git(cwd, ...args) {
  return run(cwd, "git", args).trim();
}

function commit(repo, content, message) {
  writeFileSync(join(repo, "feature.txt"), content);
  git(repo, "add", "feature.txt");
  git(repo, "commit", "-m", message);
}

const root = mkdtempSync(join(tmpdir(), "pr-helper-preflight-"));
const remote = join(root, "origin.git");
const repo = join(root, "repo");
const writer = join(root, "writer");
const fakeBin = join(root, "bin");
const feature = "feature/demo/3003";

try {
  mkdirSync(repo);
  git(root, "init", "--bare", remote);
  git(repo, "init", "-b", "master");
  git(repo, "config", "user.name", "PR Helper Test");
  git(repo, "config", "user.email", "pr-helper@example.com");
  commit(repo, "v1\n", "chore: initial");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "switch", "-c", feature);
  git(repo, "push", "-u", "origin", feature);

  git(root, "clone", remote, writer);
  git(writer, "config", "user.name", "PR Helper Remote Test");
  git(writer, "config", "user.email", "pr-helper-remote@example.com");
  git(writer, "switch", feature);
  commit(writer, "v2\n", "feat: remote update");
  git(writer, "push", "origin", feature);
  const remoteHead = git(writer, "rev-parse", "HEAD");
  assert.notEqual(git(repo, "rev-parse", `origin/${feature}`), remoteHead);

  mkdirSync(fakeBin);
  // 若 preflight 再次调用 gh，下面的成功路径应立即失败。
  const fakeGh = join(fakeBin, "gh");
  writeFileSync(
    fakeGh,
    "#!/bin/sh\nexit 99\n",
  );
  chmodSync(fakeGh, 0o755);

  git(repo, "switch", "master");
  const invalidOutput = runFailure(
    repo,
    process.execPath,
    [script, "--mode", "test"],
    { env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } },
  );
  assert.match(invalidOutput, /未提供需求 ID.*交付流程已退出/);
  assert.notEqual(git(repo, "rev-parse", `origin/${feature}`), remoteHead);
  assert.equal(
    existsSync(join(repo, ".git", "pr-helper", "test-3003.json")),
    false,
  );
  git(repo, "switch", feature);

  run(
    repo,
    process.execPath,
    [script, "--mode", "test"],
    { env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } },
  );

  assert.equal(git(repo, "rev-parse", `origin/${feature}`), remoteHead);
  const checkpoint = JSON.parse(
    readFileSync(join(repo, ".git", "pr-helper", "test-3003.json"), "utf8"),
  );
  assert.equal(checkpoint.preflight.fetched, true);
  assert.equal(checkpoint.request_id, "3003");
  assert.equal(checkpoint.request_id_source, "current_branch");
  assert.equal(checkpoint.inferred_feature_branch, feature);

  git(repo, "branch", "fix/demo/3003", "master");
  const overrideOutput = runFailure(repo, process.execPath, [
    syncScript,
    "--mode",
    "test",
    "--request-id",
    "3003",
    "--branch",
    "fix/demo/3003",
  ]);
  assert.match(overrideOutput, /不能改用 fix\/demo\/3003/);
  run(repo, process.execPath, [
    syncScript,
    "--mode",
    "test",
    "--request-id",
    "3003",
  ]);
  const syncedCheckpoint = JSON.parse(
    readFileSync(join(repo, ".git", "pr-helper", "test-3003.json"), "utf8"),
  );
  assert.equal(syncedCheckpoint.feature_branch, feature);

  run(
    repo,
    process.execPath,
    [script, "--mode", "release", "--request-id", "3003"],
    { env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } },
  );
  run(repo, process.execPath, [
    syncScript,
    "--mode",
    "release",
    "--request-id",
    "3003",
    "--branch",
    feature,
  ]);
  const explicitCheckpoint = JSON.parse(
    readFileSync(
      join(repo, ".git", "pr-helper", "release-3003.json"),
      "utf8",
    ),
  );
  assert.equal(explicitCheckpoint.request_id_source, "explicit");
  assert.equal(explicitCheckpoint.inferred_feature_branch, undefined);
  assert.equal(explicitCheckpoint.feature_branch, feature);
  console.log(
    "preflight 无 gh 依赖、输入解析、强制 fetch 与分支选择回归测试通过。",
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
