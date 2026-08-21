#!/usr/bin/env node
/** 解析需求提交，生成 PR 草稿和预填充的 GitHub compare URL。 */

import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  ensureClean,
  fail,
  handleMainError,
  loadState,
  localBranchExists,
  markCompleted,
  parseCli,
  remoteBranchExists,
  repositoryRoot,
  run,
  saveState,
  statePath,
  validateRuntime,
} from "./common.mjs";
import { resolvePullRequestTemplate } from "./pull-request-template.mjs";

function normalizeSpace(value) {
  return value.trim().split(/\s+/).join(" ");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseCommits(root, base, head, requestId) {
  const output = run(
    [
      "git",
      "log",
      "--no-merges",
      "--format=%H%x1f%B%x1e",
      `origin/${base}..origin/${head}`,
    ],
    { cwd: root },
  );
  const commits = [];
  const storyPattern = /--story=(\d+)@/;
  const namePattern = /--user=\S+\s+(.*?)(?=\s+https?:\/\/|\s*$)/s;
  for (const rawRecord of output.split("\x1e")) {
    const record = rawRecord.trim();
    const separator = record.indexOf("\x1f");
    if (!record || separator === -1) {
      continue;
    }
    const commitHash = record.slice(0, separator).trim();
    const message = record.slice(separator + 1);
    const storyMatch = message.match(storyPattern);
    if (!storyMatch || storyMatch[1] !== requestId) {
      continue;
    }
    const storyIndex = message.indexOf("--story=");
    const associatedRequirement = normalizeSpace(message.slice(storyIndex));
    const change = normalizeSpace(message.slice(0, storyIndex))
      .replace(/^[ -]+|[ -]+$/g, "")
      .replace(/^(?:feat|fix):\s*/i, "")
      .trim();
    const nameMatch = associatedRequirement.match(namePattern);
    const requirementName = nameMatch ? normalizeSpace(nameMatch[1]) : "";
    commits.push({
      hash: commitHash,
      change,
      associated_requirement: associatedRequirement,
      requirement_name: requirementName,
    });
  }
  return commits;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sectionBounds(text, title) {
  const headingPattern = new RegExp(
    `^#{1,6}[ \\t]+${escapeRegExp(title)}[ \\t]*$`,
    "m",
  );
  const heading = headingPattern.exec(text);
  if (!heading) {
    fail(`PR 模板缺少“${title}”标题。`);
  }
  const start = heading.index + heading[0].length;
  const remainder = text.slice(start);
  const nextHeading = /^#{1,6}[ \t]+.+$/m.exec(remainder);
  const end = nextHeading ? start + nextHeading.index : text.length;
  return [start, end];
}

function replaceSection(text, title, body) {
  const [start, end] = sectionBounds(text, title);
  return (
    text.slice(0, start) +
    `\n\n${body.trimEnd()}\n\n` +
    text.slice(end).replace(/^\n+/, "")
  );
}

function checkChecklist(text) {
  const [start, end] = sectionBounds(text, "清单");
  const content = text
    .slice(start, end)
    .replace(/^(\s*[-*+]\s+)\[[ xX]?\]/gm, "$1[x]");
  return text.slice(0, start) + content + text.slice(end);
}

function githubRepository(root) {
  const remote = run(["git", "remote", "get-url", "origin"], { cwd: root });
  const scpMatch = remote.match(/^git@github\.com:([^/]+\/.+?)(?:\.git)?$/);
  if (scpMatch) {
    return scpMatch[1].replace(/\.git$/, "");
  }
  try {
    const parsed = new URL(remote);
    if (parsed.hostname === "github.com") {
      return parsed.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
    }
  } catch {
    // 下方统一给出可执行的错误信息。
  }
  fail(`origin 不是可识别的 GitHub 仓库 URL：${remote}`);
}

function encodeBranch(branch) {
  return branch.split("/").map(encodeURIComponent).join("/");
}

function resolveGitDirectory(root, name) {
  const value = run(["git", "rev-parse", "--git-path", name], { cwd: root });
  return isAbsolute(value) ? value : resolve(root, value);
}

function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

function main() {
  validateRuntime();
  const args = parseCli({
    description: "解析需求提交并生成 PR 草稿与 GitHub compare URL。",
    allowFullOutput: true,
  });
  const root = repositoryRoot();
  ensureClean(root);
  const state = loadState(root, args.mode, args.requestId);
  if (!state.completed.includes("delivery_prepared")) {
    fail("尚未记录交付分支准备。请先运行 prepare-delivery.mjs。");
  }
  const base = state.base_branch;
  const head = state.head_branch;
  if (!base || !head) {
    fail("检查点中没有交付分支。请先运行 prepare-delivery.mjs。");
  }
  for (const branch of [base, head]) {
    if (!remoteBranchExists(root, branch)) {
      fail(`远程分支 origin/${branch} 不存在。请先 fetch 或 push。`);
    }
  }

  const commits = parseCommits(root, base, head, args.requestId);
  if (commits.length === 0) {
    fail(
      `origin/${base}..origin/${head} 中没有包含 ` +
        `--story=${args.requestId}@ 的普通提交。`,
    );
  }
  const changes = unique(commits.map((item) => item.change));
  const associated = unique(
    commits.map((item) => item.associated_requirement),
  );
  const names = unique(commits.map((item) => item.requirement_name));
  if (names.length === 0) {
    fail("无法从 --user=<姓名> 与最后一个 URL 之间解析需求名称。");
  }
  if (names.length > 1) {
    fail(`匹配提交包含不同的需求名称：${names.join("、")}`);
  }

  const { path: templatePath, source: templateSource } =
    resolvePullRequestTemplate(root);
  const template = readFileSync(templatePath, "utf8");
  const associatedBody =
    associated.length === 1
      ? associated[0]
      : associated.map((item) => `- ${item}`).join("\n");
  const changesBody = changes.map((item) => `- ${item}`).join("\n");
  let body = replaceSection(template, "变更说明", associatedBody);
  body = replaceSection(body, "描述", changesBody);
  body = checkChecklist(body);

  const titlePrefix = args.mode === "test" ? "【测试】" : "【预发布】";
  const title = `${titlePrefix}${names[0]}`;
  const repository = githubRepository(root);
  const comparePath = `${encodeBranch(base)}...${encodeBranch(head)}`;
  const query = new URLSearchParams({ quick_pull: "1", title, body });
  const compareUrl = `https://github.com/${repository}/compare/${comparePath}?${query}`;

  const draftDir = resolveGitDirectory(root, "pr-helper/drafts");
  mkdirSync(draftDir, { recursive: true });
  const draftPath = join(draftDir, `${args.mode}-${args.requestId}.md`);
  writeFileSync(draftPath, `${body.trimEnd()}\n`, "utf8");

  const resultDir = resolveGitDirectory(root, "pr-helper/results");
  mkdirSync(resultDir, { recursive: true });
  const resultPath = join(resultDir, `${args.mode}-${args.requestId}.json`);

  const feature = state.feature_branch;
  if (!feature) {
    fail("检查点中没有需求分支，无法在流程完成后切回。");
  }
  if (!localBranchExists(root, feature)) {
    fail(`本地需求分支 ${feature} 不存在，无法在流程完成后切回。`);
  }
  run(["git", "switch", "--quiet", feature], { cwd: root, inherit: true });

  state.draft = {
    title,
    base,
    head,
    path: draftPath,
    compare_url: compareUrl,
    commits: commits.map((item) => item.hash),
    template_path: templatePath,
    template_source: templateSource,
    result_path: resultPath,
  };
  state.active_branch = feature;
  markCompleted(state, "draft_built");
  const checkpoint = statePath(root, args.mode, args.requestId);
  const result = {
    title,
    base,
    head,
    compare_url: compareUrl,
    draft_path: draftPath,
    result_path: resultPath,
    template_path: templatePath,
    template_source: templateSource,
    checkpoint,
    commits,
    current_branch: feature,
    submitted: false,
  };
  writeJsonAtomic(resultPath, result);
  saveState(root, args.mode, args.requestId, state);
  const summary = {
    title,
    base,
    head,
    draft_path: draftPath,
    result_path: resultPath,
    checkpoint,
    commit_count: commits.length,
    current_branch: feature,
    submitted: false,
  };
  console.log(JSON.stringify(args.fullOutput ? result : summary, null, 2));
}

try {
  main();
} catch (error) {
  handleMainError(error);
}
