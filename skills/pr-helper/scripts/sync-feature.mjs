#!/usr/bin/env node
/** 查找、切换并快进同步指定需求的 feature、fix 或 bugfix 分支。 */

import {
  ensureClean,
  fail,
  handleMainError,
  loadState,
  markCompleted,
  parseCli,
  repositoryRoot,
  saveState,
  selectBranch,
  syncRequirementBranch,
  validateRuntime,
} from "./common.mjs";

function main() {
  validateRuntime();
  const args = parseCli({
    description: "查找并同步 feature、fix 或 bugfix 需求分支。",
    allowBranch: true,
  });
  const root = repositoryRoot();
  const state = loadState(root, args.mode, args.requestId);
  if (!state.completed.includes("preflight")) {
    fail("尚未记录前置检查。请先运行 preflight.mjs。");
  }
  ensureClean(root);
  const inferredBranch =
    state.request_id_source === "current_branch"
      ? state.inferred_feature_branch
      : undefined;
  if (inferredBranch && args.branch && args.branch !== inferredBranch) {
    fail(
      `需求 ID 来自当前分支 ${inferredBranch}，不能改用 ${args.branch}。` +
        "请继续使用已记录的当前分支。",
    );
  }
  const branch = selectBranch(
    root,
    "requirement",
    args.requestId,
    inferredBranch ?? args.branch,
  );
  const featureHead = syncRequirementBranch(root, branch);
  state.feature_branch = branch;
  state.feature_head = featureHead;
  markCompleted(state, "feature_synced");
  const path = saveState(root, args.mode, args.requestId, state);
  console.log(`需求分支已同步：${branch}`);
  console.log(`检查点：${path}`);
}

try {
  main();
} catch (error) {
  handleMainError(error);
}
