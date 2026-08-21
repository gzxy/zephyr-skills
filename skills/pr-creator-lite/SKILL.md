---
name: pr-creator-lite
description: >
  Cursor Skill：PR 自动化流程助手。识别关键词「转测」「提测」「submit test」「提单」「上线」「发布」「create release」时触发。
  自动执行 git 操作（分支校验、合并、推送），收集提交信息，填充 PR 模板，并打开 GitHub PR 创建页面供用户手动提交。
  - 转测/提测 → pr-test.sh
  - 提单/上线/发布 → pr-release.sh
compatibility: Requires git, gh (GitHub CLI). Designed for Cursor Agent.
---

# PR 流程 Skill

## 意图识别

| 关键词                              | 脚本                    |
| ----------------------------------- | ----------------------- |
| 转测 / 提测 / submit test           | `scripts/pr-test.sh`    |
| 提单 / 上线 / 发布 / create release | `scripts/pr-release.sh` |

## 步骤 1 — 运行脚本

```bash
# ⚠️ 必须使用 required_permissions: ["all"]
source ~/.zshrc && bash .cursor/skills/pr-creator-lite/scripts/pr-test.sh      # 转测
source ~/.zshrc && bash .cursor/skills/pr-creator-lite/scripts/pr-release.sh   # 提单
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

**Body**（严格按照 `references/pr-template.md` 的结构填充，**删除所有以 `>` 开头的占位引用行**）：

- `# 变更说明` → 删除 `>` 占位行，填入 TAPD_INFO
- `# 描述` → 删除 `>` 占位行，留空，由用户自行填写
- `# 清单` → 保持模板原始内容，不做任何修改

## 步骤 3 — 生成 PR 链接

使用 Python 对 title 和 body 进行 URL 编码，构造 compare URL，然后**在对话框中以 Markdown 链接形式输出**，供用户直接点击：

```
https://github.com/{OWNER}/{REPO}/compare/{BASE_BRANCH}...{TARGET_BRANCH}?quick_pull=1&title={encoded_title}&body={encoded_body}
```

**生成方式（Python）**：

```bash
python3 - <<'EOF'
from urllib.parse import quote
title = """<TITLE>"""
body = """<BODY>"""
encoded_title = quote(title, safe='')
encoded_body = quote(body, safe='')
url = f"https://github.com/{OWNER}/{REPO}/compare/{BASE_BRANCH}...{TARGET_BRANCH}?quick_pull=1&title={encoded_title}&body={encoded_body}"
print(url)
EOF
```

拿到 URL 后，在对话框中输出：

```
[点击创建 PR](构造好的完整 URL)
```

流程完成后，如有 TAPD 信息缺失，一并提醒。

## ⚠️ 特别注意

**禁止自动提交 PR / MR！** 步骤 3 仅打开浏览器的 PR 创建页面（预填 title 和 body），由用户自行检查、补充变更信息后手动点击提交。Agent 不得使用 `gh pr create` 或任何方式直接创建 PR。

**禁止删除分支！** Agent 不得执行任何删除本地或远程分支的 git 命令（如 `git branch -d`、`git branch -D`、`git push origin --delete` 等）。

**禁止回退代码！** Agent 不得执行任何回退/撤销提交的 git 命令（如 `git reset`、`git revert`、`git restore`、`git checkout -- .` 等会丢失或覆盖代码的操作）。

**禁止使用变基** Agent 不得执行 git rebase 处理分支代码

**冲突提醒** Agent 在处理分支时遇到冲突, 不要尝试自己解决, 一定要提示用户手动处理
