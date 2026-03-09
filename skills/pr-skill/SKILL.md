---
name: pr-skill
description: >
  Cursor Skill：PR 自动化流程助手。识别关键词「转测」「提测」「submit test」「提单」「上线」「发布」「create release」时触发。
  自动执行 git 操作（分支校验、合并、推送），收集提交信息，填充 PR 模板，并打开 GitHub PR 创建页面供用户手动提交。
  - 转测/提测 → pr-test.sh
  - 提单/上线/发布 → pr-release.sh
compatibility: Requires git, gh (GitHub CLI). Designed for Cursor Agent.
---

# PR 流程 Skill

## 意图识别

| 关键词 | 脚本 |
|--------|------|
| 转测 / 提测 / submit test | `scripts/pr-test.sh` |
| 提单 / 上线 / 发布 / create release | `scripts/pr-release.sh` |

## 步骤 1 — 运行脚本

```bash
# ⚠️ 必须使用 required_permissions: ["all"]
source ~/.zshrc && bash .cursor/skills/pr-skill/scripts/pr-test.sh      # 转测
source ~/.zshrc && bash .cursor/skills/pr-skill/scripts/pr-release.sh   # 提单
```

- 脚本自动完成：环境检查 → 分支校验 → fetch → 合并 → 推送 → 收集数据
- 成功时输出 `===PR_DATA===...===PR_DATA_END===` 数据块
- 报错（`❌ ERROR`）→ 告知用户并**停止**

## 步骤 2 — 生成 PR 内容

从脚本输出提取信息，生成：

**Title**：
- 转测 → `【测试】{STORY_TITLE}`，并严格按照此格式
- 提单 → `【预发布】{STORY_TITLE}`，并严格按照此格式
- `STORY_TITLE` 由脚本直接提供，直接使用。若为空则使用 `TITLE_RAW`

**Body**（按 `.github/PULL_REQUEST_TEMPLATE.md` 填充）：
- 「变更说明」→ 在该章节下以追加的方式填入 TAPD_INFO，注意此文本不要使用以 `>` 开头的引用
- 「描述」→ 基于脚本输出的 `COMMIT_LOG`（提交列表）和 `DIFF_STAT`（文件变更统计），提炼 3-5 条简洁的代码变更描述，以无序列表（`-`）形式填入，注意此文本不要使用以 `>` 开头的引用
- **其他所有章节（示例、如何进行测试、影响、清单）保持模板默认占位文字，不做任何修改**

## 步骤 3 — 打开 PR 页面

⚠️ **必须使用 `required_permissions: ["all"]`**，title 和 body 必须使用 `encodeURIComponent`（或等效方式）进行 URL 编码**，然后通过写入**临时 HTML 文件**来打开（避免超长 URL 作为 shell 参数传递时失败）：

```
https://github.com/{OWNER}/{REPO}/compare/{BASE_BRANCH}...{TARGET_BRANCH}?quick_pull=1&title={encoded_title}&body={encoded_body}
```

**打开方式（Node.js）**：
```js
const fs = require("fs");
const { exec } = require("child_process");
const tmpFile = `/tmp/pr_open_${Date.now()}.html`;
fs.writeFileSync(tmpFile, `<script>location.href=${JSON.stringify(url)}</script>`);
exec(`open ${tmpFile}`, () => setTimeout(() => fs.unlinkSync(tmpFile), 3000));
```

整个流程完成后，必须清理临时文件，不能残留文件到用户工作区。如有 TAPD 信息缺失，一并提醒。

## ⚠️ 特别注意

**禁止自动提交 PR / MR！** 步骤 3 仅打开浏览器的 PR 创建页面（预填 title 和 body），由用户自行检查、补充变更信息后手动点击提交。Agent 不得使用 `gh pr create` 或任何方式直接创建 PR。

**禁止删除分支！** Agent 不得执行任何删除本地或远程分支的 git 命令（如 `git branch -d`、`git branch -D`、`git push origin --delete` 等）。

**禁止回退代码！** Agent 不得执行任何回退/撤销提交的 git 命令（如 `git reset`、`git revert`、`git restore`、`git checkout -- .` 等会丢失或覆盖代码的操作）。
