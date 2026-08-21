#!/usr/bin/env node
/** 检查仓库清洁度、上游状态，并强制 fetch origin。 */

import {
  ensureClean,
  fail,
  handleMainError,
  inferRequestIdFromCurrentBranch,
  loadState,
  markCompleted,
  parseCli,
  repositoryRoot,
  run,
  saveState,
  validateRuntime,
} from "./common.mjs";

function main() {
  validateRuntime();
  const args = parseCli({
    description:
      "检查仓库清洁度、上游状态并强制更新 origin。" +
      "（--fetch 参数仅为兼容旧调用保留）",
    allowFetch: true,
    allowMissingRequestId: true,
  });
  const root = repositoryRoot();
  const inferredFromCurrentBranch = args.requestId === undefined;
  let branch;
  try {
    branch = run(["git", "symbolic-ref", "--quiet", "--short", "HEAD"], {
      cwd: root,
    });
  } catch (error) {
    if (inferredFromCurrentBranch) {
      fail("未提供需求 ID，且当前仓库处于 detached HEAD。交付流程已退出。");
    }
    throw error;
  }
  if (inferredFromCurrentBranch) {
    args.requestId = inferRequestIdFromCurrentBranch(branch);
  }
  const remotes = run(["git", "remote"], { cwd: root }).split(/\r?\n/);
  if (!remotes.includes("origin")) {
    fail("交付流程要求仓库存在 `origin` 远程。");
  }
  ensureClean(root);
  let upstream;
  try {
    upstream = run(
      ["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      { cwd: root },
    );
  } catch {
    fail(
      `当前分支 ${branch} 没有上游分支。继续前请运行 ` +
        "`git push -u origin <branch>`。",
    );
  }
  run(["git", "fetch", "origin"], { cwd: root, inherit: true });
  const counts = run(
    ["git", "rev-list", "--left-right", "--count", `${upstream}...HEAD`],
    { cwd: root },
  ).split(/\s+/);
  if (counts.length !== 2) {
    fail("无法判断当前分支是否已推送。");
  }
  const [behind, ahead] = counts.map((item) => Number.parseInt(item, 10));
  if (ahead > 0) {
    fail(`当前分支 ${branch} 有 ${ahead} 个提交尚未推送到 ${upstream}。`);
  }
  const state = loadState(root, args.mode, args.requestId);
  if (inferredFromCurrentBranch) {
    state.request_id_source = "current_branch";
    state.inferred_feature_branch = branch;
  } else {
    state.request_id_source = "explicit";
    delete state.inferred_feature_branch;
  }
  state.preflight = {
    branch,
    upstream,
    behind,
    fetched: true,
  };
  markCompleted(state, "preflight");
  const path = saveState(root, args.mode, args.requestId, state);
  console.log(`前置检查通过：${root}`);
  console.log(
    `需求 ID：${args.requestId}` +
      (inferredFromCurrentBranch ? `（从当前分支 ${branch} 推断）` : "（用户指定）"),
  );
  console.log(`当前分支：${branch}（领先 0，落后 ${behind}）`);
  console.log(`检查点：${path}`);
}

try {
  main();
} catch (error) {
  handleMainError(error);
}
