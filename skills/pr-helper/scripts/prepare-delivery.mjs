#!/usr/bin/env node
/** 创建或更新交付分支，合并来源分支并以普通方式推送。 */

import {
  CommandError,
  commandSucceeds,
  ensureClean,
  fail,
  handleMainError,
  loadState,
  markCompleted,
  mergeInProgress,
  parseCli,
  releaseBranchCandidates,
  releaseBranchName,
  remoteBranchExists,
  repositoryRoot,
  requirementSuffix,
  run,
  saveState,
  switchAndUpdate,
  syncRequirementBranch,
  unresolvedFiles,
  validateRuntime,
} from "./common.mjs";

function invalidateStage(state, stage) {
  const invalidStages = new Set([
    stage,
    "delivery_prepared",
    "draft_built",
  ]);
  if (stage === "release_branch_pushed") {
    invalidStages.add("prerelease_branch_pushed");
  }
  state.completed = state.completed.filter((item) => !invalidStages.has(item));
  delete state.draft;
}

function conflictResolutionAdvice(conflicts) {
  const conflictList =
    conflicts.length > 0
      ? `\n冲突文件：\n- ${conflicts.join("\n- ")}`
      : "\n请运行 `git status --short` 查看冲突文件。";
  return (
    `${conflictList}\n\n处理建议：\n` +
    "1. 运行 `git status --short` 确认冲突类型和当前 merge 状态。\n" +
    "2. 逐个检查冲突文件，理解两侧改动后编辑为最终内容；" +
    "不要直接批量选择 ours/theirs。\n" +
    "3. 每解决一个文件，由用户手动运行 `git add -- <冲突文件路径>`；" +
    "不要使用 `git add .` 或 `git add -A`。\n" +
    "4. 运行 `git diff --check`、`git diff --cached --check` 和相关测试，" +
    "再用 `git diff --name-only --diff-filter=U` 确认没有未解决文件。\n" +
    "5. 确认结果后，由用户手动运行 `git commit` 完成当前 merge commit，" +
    "然后重新运行本次 prepare-delivery 命令继续流程。\n" +
    "如果需要 PR Helper 协助，请明确授权并指定冲突文件；" +
    "PR Helper 不会自动解决、自动提交或执行 `git merge --abort`。"
  );
}

function prepareBranch({
  root,
  state,
  mode,
  requestId,
  stage,
  branch,
  base,
  source,
}) {
  if (state.completed.includes(stage)) {
    if (remoteBranchExists(root, branch)) {
      const sourceRef = remoteBranchExists(root, source)
        ? `origin/${source}`
        : source;
      const branchRef = `origin/${branch}`;
      const sourceMerged = commandSucceeds(
        ["git", "merge-base", "--is-ancestor", sourceRef, branchRef],
        root,
      );
      if (sourceMerged) {
        console.log(`跳过已完成阶段：${stage}（${branch}）`);
        return;
      }
      console.log(
        `${branchRef} 未包含 ${sourceRef} 的最新提交，检查点失效，将重新执行该阶段。`,
      );
      invalidateStage(state, stage);
    } else {
      console.log(`origin/${branch} 已不存在，检查点失效，将重新执行该阶段。`);
      invalidateStage(state, stage);
    }
  }

  state.stage = `${stage}:switch`;
  state.active_branch = branch;
  saveState(root, mode, requestId, state);
  const created = switchAndUpdate(root, branch, {
    base,
    remoteRefsFetched: true,
  });
  state.branches ??= {};
  state.branches[stage] = {
    name: branch,
    base,
    source,
    created,
  };

  state.stage = `${stage}:merge`;
  saveState(root, mode, requestId, state);
  try {
    run(["git", "merge", "--no-edit", source], {
      cwd: root,
      inherit: true,
    });
  } catch (error) {
    if (!(error instanceof CommandError)) {
      throw error;
    }
    const conflicts = unresolvedFiles(root);
    state.stage = conflicts.length > 0 ? `${stage}:conflict` : `${stage}:merge_failed`;
    state.conflicts = conflicts;
    saveState(root, mode, requestId, state);
    if (conflicts.length > 0) {
      fail(
        `将 ${source} 合并到 ${branch} 时发生冲突。冲突现场已保留；` +
          "流程已停止。" +
          conflictResolutionAdvice(conflicts),
      );
    }
    throw error;
  }

  delete state.conflicts;
  state.stage = `${stage}:push`;
  saveState(root, mode, requestId, state);
  run(["git", "push", "-u", "origin", branch], {
    cwd: root,
    inherit: true,
  });
  markCompleted(state, stage);
  saveState(root, mode, requestId, state);
}

function main() {
  validateRuntime();
  const args = parseCli({
    description: "创建或更新转测、提单所需的交付分支。",
    allowNewReleaseDate: true,
  });
  if (args.newReleaseDate && args.mode !== "release") {
    fail("--new-release-date 仅适用于提单模式。");
  }
  const root = repositoryRoot();
  if (mergeInProgress(root)) {
    const conflicts = unresolvedFiles(root);
    fail(
      "仓库中已有进行中的 merge。冲突现场保持不变，流程已停止。" +
        conflictResolutionAdvice(conflicts),
    );
  }
  ensureClean(root);
  const state = loadState(root, args.mode, args.requestId);
  if (!state.completed.includes("feature_synced")) {
    fail("尚未记录需求分支同步。请先运行 sync-feature.mjs。");
  }
  const requirement = state.feature_branch;
  if (!requirement) {
    fail("检查点中没有需求分支。请先运行 sync-feature.mjs。");
  }
  run(["git", "fetch", "origin"], { cwd: root, inherit: true });
  const featureHead = syncRequirementBranch(root, requirement, {
    remoteRefsFetched: true,
  });
  if (state.feature_head && state.feature_head !== featureHead) {
    console.log(
      `需求分支已更新：${state.feature_head.slice(0, 12)} -> ` +
        `${featureHead.slice(0, 12)}。`,
    );
  }
  state.feature_head = featureHead;
  markCompleted(state, "feature_synced");
  saveState(root, args.mode, args.requestId, state);
  const suffix = requirementSuffix(requirement, args.requestId);

  if (args.mode === "test") {
    const temporary = `tmp_feature/${suffix}`;
    prepareBranch({
      root,
      state,
      mode: args.mode,
      requestId: args.requestId,
      stage: "test_branch_pushed",
      branch: temporary,
      base: "test",
      source: requirement,
    });
    state.head_branch = temporary;
    state.base_branch = "test";
  } else {
    const existingReleases = releaseBranchCandidates(
      root,
      requirement,
      args.requestId,
    );
    const todayRelease = releaseBranchName(requirement, args.requestId);
    const release =
      args.newReleaseDate || existingReleases.length === 0
        ? todayRelease
        : existingReleases[0];
    if (existingReleases.includes(release)) {
      console.log(`复用已有 release 分支：${release}`);
    } else {
      console.log(`将创建 release 分支：${release}`);
    }
    prepareBranch({
      root,
      state,
      mode: args.mode,
      requestId: args.requestId,
      stage: "release_branch_pushed",
      branch: release,
      base: "master",
      source: requirement,
    });
    const temporary = `tmp_${release}`;
    prepareBranch({
      root,
      state,
      mode: args.mode,
      requestId: args.requestId,
      stage: "prerelease_branch_pushed",
      branch: temporary,
      base: "pre_release",
      source: release,
    });
    state.release_branch = release;
    state.head_branch = temporary;
    state.base_branch = "pre_release";
  }

  markCompleted(state, "delivery_prepared");
  const path = saveState(root, args.mode, args.requestId, state);
  console.log(`交付分支已准备完成：${args.mode}/${args.requestId}`);
  console.log(`来源分支：${state.head_branch}`);
  console.log(`目标分支：${state.base_branch}`);
  console.log(`检查点：${path}`);
}

try {
  main();
} catch (error) {
  handleMainError(error);
}
