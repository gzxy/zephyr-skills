#!/usr/bin/env node
/** PR Helper 交付流程的零依赖公共模块，兼容 Node.js 16+。 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export class PrHelperError extends Error {
  constructor(message) {
    super(message);
    this.name = "PrHelperError";
  }
}

export class CommandError extends PrHelperError {
  constructor(argv, status, output, cause) {
    const rendered = argv.join(" ");
    const detail = output ? `\n${output}` : "";
    super(`命令执行失败（${status ?? "无法启动"}）：${rendered}${detail}`);
    this.name = "CommandError";
    this.argv = argv;
    this.status = status;
    this.output = output;
    this.cause = cause;
  }
}

export function fail(message) {
  throw new PrHelperError(message);
}

export function run(argv, { cwd, check = true, inherit = false } = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  const output = inherit
    ? ""
    : `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.error || (check && result.status !== 0)) {
    throw new CommandError(argv, result.status, output, result.error);
  }
  return output;
}

export function commandSucceeds(argv, cwd) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    stdio: "ignore",
  });
  return !result.error && result.status === 0;
}

export function validateRuntime() {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (!Number.isInteger(major) || major < 16) {
    fail(`PR Helper 要求 Node.js 16+，当前版本为 ${process.version}。`);
  }
}

export function validateRequestId(value) {
  if (!/^\d+$/.test(value ?? "")) {
    fail("需求 ID 必须只包含数字。");
  }
  return value;
}

export function inferRequestIdFromCurrentBranch(branch) {
  const match = branch.match(/^feature\/[^/]+\/(?:[^/]+\/)?(\d+)$/);
  if (!match) {
    fail(
      `未提供需求 ID，且当前分支 ${branch} 不符合 ` +
        "feature/<username>/[<功能简写>/]<需求ID> 格式。交付流程已退出。",
    );
  }
  return match[1];
}

export function parseCli({
  description,
  allowFetch = false,
  allowBranch = false,
  allowNewReleaseDate = false,
  allowMissingRequestId = false,
  allowFullOutput = false,
}) {
  const values = { fetch: false, newReleaseDate: false, fullOutput: false };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "-h" || token === "--help") {
      const extras =
        `${allowFetch ? " [--fetch]" : ""}` +
        `${allowBranch ? " [--branch <分支>]" : ""}` +
        `${allowNewReleaseDate ? " [--new-release-date]" : ""}` +
        `${allowFullOutput ? " [--full-output]" : ""}`;
      console.log(description);
      const requestIdUsage = allowMissingRequestId
        ? " [--request-id <需求ID>]"
        : " --request-id <需求ID>";
      console.log(
        `用法：node ${process.argv[1]} --mode <test|release>${requestIdUsage}${extras}`,
      );
      process.exit(0);
    }
    if (token === "--fetch" && allowFetch) {
      values.fetch = true;
      continue;
    }
    if (token === "--new-release-date" && allowNewReleaseDate) {
      values.newReleaseDate = true;
      continue;
    }
    if (token === "--full-output" && allowFullOutput) {
      values.fullOutput = true;
      continue;
    }
    const keyByToken = {
      "--mode": "mode",
      "--request-id": "requestId",
      ...(allowBranch ? { "--branch": "branch" } : {}),
    };
    const key = keyByToken[token];
    if (!key) {
      fail(`未知参数：${token}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`参数 ${token} 缺少值。`);
    }
    values[key] = value;
    index += 1;
  }
  if (!values.mode || !["test", "release"].includes(values.mode)) {
    fail("必须通过 --mode 指定 test 或 release。");
  }
  if (values.requestId !== undefined || !allowMissingRequestId) {
    values.requestId = validateRequestId(values.requestId);
  }
  return values;
}

export function repositoryRoot() {
  try {
    return resolve(run(["git", "rev-parse", "--show-toplevel"]));
  } catch (error) {
    if (error instanceof CommandError) {
      throw new PrHelperError("请在目标 Git 仓库内运行此脚本。");
    }
    throw error;
  }
}

export function gitPath(root, name) {
  const value = run(["git", "rev-parse", "--git-path", name], { cwd: root });
  return isAbsolute(value) ? value : resolve(root, value);
}

export function statePath(root, mode, requestId) {
  return join(gitPath(root, "pr-helper"), `${mode}-${requestId}.json`);
}

export function loadState(root, mode, requestId) {
  const path = statePath(root, mode, requestId);
  if (!existsSync(path)) {
    return { mode, request_id: requestId, completed: [] };
  }
  let state;
  try {
    state = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new PrHelperError(`无法读取检查点 ${path}：${error.message}`);
  }
  if (state.mode !== mode || String(state.request_id) !== requestId) {
    fail(`检查点与当前流程 ${mode}/${requestId} 不匹配：${path}`);
  }
  state.request_id = requestId;
  state.completed ??= [];
  return state;
}

export function saveState(root, mode, requestId, state) {
  const path = statePath(root, mode, requestId);
  mkdirSync(dirname(path), { recursive: true });
  Object.assign(state, {
    mode,
    request_id: requestId,
    updated_at: new Date().toISOString(),
  });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
  return path;
}

export function markCompleted(state, stage) {
  state.completed ??= [];
  if (!state.completed.includes(stage)) {
    state.completed.push(stage);
  }
  state.stage = stage;
}

export function ensureClean(root) {
  const status = run(
    ["git", "status", "--porcelain=v1", "--untracked-files=normal"],
    { cwd: root },
  );
  if (status) {
    fail(
      "工作区或暂存区不干净。继续前请提交并推送所有需要保留的变更；" +
        `PR Helper 不会 stash 或丢弃它们。\n${status}`,
    );
  }
}

export function mergeInProgress(root) {
  return existsSync(gitPath(root, "MERGE_HEAD"));
}

export function unresolvedFiles(root) {
  const output = run(["git", "diff", "--name-only", "--diff-filter=U"], {
    cwd: root,
    check: false,
  });
  return output.split(/\r?\n/).filter(Boolean);
}

export function localBranchExists(root, branch) {
  return commandSucceeds(
    ["git", "show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    root,
  );
}

export function remoteBranchExists(root, branch) {
  return commandSucceeds(
    [
      "git",
      "show-ref",
      "--verify",
      "--quiet",
      `refs/remotes/origin/${branch}`,
    ],
    root,
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requirementBranchMatch(branch, requestId) {
  const pattern = new RegExp(
    `^(feature|fix|bugfix)/([^/]+)/(?:([^/]+)/)?` +
      `(${escapeRegExp(requestId)})([^0-9/][^/]*)?$`,
  );
  return branch.match(pattern);
}

export function requirementBranchInfo(branch, requestId) {
  const match = requirementBranchMatch(branch, requestId);
  if (!match) {
    fail(`需求分支格式不符合预期：${branch}`);
  }
  const [, prefix, username, shorthand, matchedRequestId, trailing = ""] =
    match;
  return {
    prefix,
    username,
    shorthand: shorthand ?? "",
    requestId: matchedRequestId,
    trailing,
  };
}

export function isRequirementBranchForRequest(branch, requestId) {
  return Boolean(requirementBranchMatch(branch, requestId));
}

function branchNames(root) {
  const output = run(
    [
      "git",
      "for-each-ref",
      "--format=%(refname)",
      "refs/heads",
      "refs/remotes/origin",
    ],
    { cwd: root },
  );
  const branches = new Set();
  for (const ref of output.split(/\r?\n/)) {
    if (ref.startsWith("refs/heads/")) {
      branches.add(ref.slice("refs/heads/".length));
    } else if (ref.startsWith("refs/remotes/origin/")) {
      branches.add(ref.slice("refs/remotes/origin/".length));
    }
  }
  return [...branches];
}

export function branchCandidates(root, prefix, requestId) {
  const pattern =
    prefix === "requirement"
      ? null
      : new RegExp(`^${escapeRegExp(prefix)}/.+/${escapeRegExp(requestId)}$`);
  return branchNames(root)
    .filter((branch) =>
      prefix === "requirement"
        ? isRequirementBranchForRequest(branch, requestId)
        : pattern.test(branch),
    )
    .sort();
}

export function selectBranch(root, prefix, requestId, requested) {
  const candidates = branchCandidates(root, prefix, requestId);
  const expected =
    prefix === "requirement"
      ? `(feature|fix|bugfix)/<username>/[<功能简写>/]${requestId}[非数字开头的后缀]`
      : `${prefix}/**/${requestId}`;
  if (requested) {
    if (!candidates.includes(requested)) {
      fail(
        `指定分支 ${requested} 不是可用的 ${expected} 分支。` +
          `可用分支：${candidates.join("、") || "无"}`,
      );
    }
    return requested;
  }
  if (candidates.length === 0) {
    fail(`未找到本地或 origin 中符合 ${expected} 的分支。`);
  }
  if (candidates.length > 1) {
    fail(
      "找到多个匹配分支。请使用 --branch 指定以下一个完整分支名：\n- " +
        candidates.join("\n- "),
    );
  }
  return candidates[0];
}

function fastForwardFromFetchedRef(root, branch) {
  run(["git", "merge", "--ff-only", `origin/${branch}`], {
    cwd: root,
    inherit: true,
  });
}

export function switchAndUpdate(
  root,
  branch,
  { base, remoteRefsFetched = false } = {},
) {
  if (localBranchExists(root, branch)) {
    run(["git", "switch", branch], { cwd: root, inherit: true });
    if (remoteBranchExists(root, branch)) {
      if (remoteRefsFetched) {
        fastForwardFromFetchedRef(root, branch);
      } else {
        run(["git", "pull", "--ff-only", "origin", branch], {
          cwd: root,
          inherit: true,
        });
      }
    }
    return false;
  }
  if (remoteBranchExists(root, branch)) {
    run(["git", "switch", "--track", "-c", branch, `origin/${branch}`], {
      cwd: root,
      inherit: true,
    });
    if (remoteRefsFetched) {
      fastForwardFromFetchedRef(root, branch);
    } else {
      run(["git", "pull", "--ff-only", "origin", branch], {
        cwd: root,
        inherit: true,
      });
    }
    return false;
  }
  if (!base) {
    fail(`分支 ${branch} 在本地和 origin 均不存在。`);
  }
  switchAndUpdate(root, base, { remoteRefsFetched });
  run(["git", "switch", "-c", branch], { cwd: root, inherit: true });
  return true;
}

export function syncRequirementBranch(
  root,
  branch,
  { remoteRefsFetched = false } = {},
) {
  switchAndUpdate(root, branch, { remoteRefsFetched });
  if (!remoteBranchExists(root, branch)) {
    fail(
      `需求分支 ${branch} 仅存在于本地。继续前请运行 ` +
        `\`git push -u origin ${branch}\`。`,
    );
  }
  const counts = run(
    [
      "git",
      "rev-list",
      "--left-right",
      "--count",
      `origin/${branch}...${branch}`,
    ],
    { cwd: root },
  ).split(/\s+/);
  const ahead = counts.length === 2 ? Number.parseInt(counts[1], 10) : NaN;
  if (!Number.isInteger(ahead) || ahead !== 0) {
    fail(
      `需求分支 ${branch} 有 ${Number.isInteger(ahead) ? ahead : "未知数量"}` +
        "个本地提交尚未推送到 origin。",
    );
  }
  return run(["git", "rev-parse", branch], { cwd: root });
}

export function requirementSuffix(branch, requestId) {
  const info = requirementBranchInfo(branch, requestId);
  return [info.username, info.shorthand, `${info.requestId}${info.trailing}`]
    .filter(Boolean)
    .join("/");
}

function dateStamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    fail("无法生成 release 分支日期：日期无效。");
  }
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function isValidDateStamp(value) {
  if (!/^\d{8}$/.test(value)) {
    return false;
  }
  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(4, 6), 10);
  const day = Number.parseInt(value.slice(6, 8), 10);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export function releaseBranchName(branch, requestId, date = new Date()) {
  const info = requirementBranchInfo(branch, requestId);
  return `release/${info.username}/${dateStamp(date)}/${info.requestId}`;
}

export function releaseBranchCandidates(root, branch, requestId) {
  const info = requirementBranchInfo(branch, requestId);
  const pattern = new RegExp(
    `^release/${escapeRegExp(info.username)}/(\\d{8})/` +
      `${escapeRegExp(info.requestId)}$`,
  );
  return branchNames(root)
    .map((candidate) => {
      const match = candidate.match(pattern);
      return match && isValidDateStamp(match[1])
        ? { branch: candidate, date: match[1] }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.date.localeCompare(left.date))
    .map((item) => item.branch);
}

export function handleMainError(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`错误：${message}`);
  process.exitCode = 1;
}
