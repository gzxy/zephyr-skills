---
name: pr-helper
description: 在提交 PR 前审查代码、为“转测”或“提单”准备可续跑的 GitHub 交付分支，或分析 PR 中的 Cursor Bot 评论。仅在用户显式调用 $pr-helper 或 /pr-helper 时使用；普通 Git 或 PR 问题不要触发。
---

# PR 助手

提供三种显式模式。参考文件仅用于指导工作流，不代表可以自动修改仓库；只执行用户明确请求的模式。

## 识别模式

- **代码审查：** 用户显式调用本 skill，并表达 `review`、代码审查等意图。读取 [references/code-review.md](references/code-review.md)。
- **交付 PR：** 用户说“转测”或“提单”。需求 ID 可选；用户未提供时，从当前本地 `feature` 分支推断，无法推断则退出流程。随后读取 [references/delivery-pr.md](references/delivery-pr.md)。
- **Cursor Bot 评论：** 用户提供 GitHub PR URL，并要求修复、评估或处理 review comment。读取 [references/cursor-bot-feedback.md](references/cursor-bot-feedback.md)。
- **继续执行：** “继续”或“重试”用于恢复当前暂停的交付模式和需求 ID。继续前检查仓库与 `.git/pr-helper/` 检查点，不要重做已完成阶段。

如果请求可能匹配多个模式，同时出现 PR URL 和处理评论的意图时，优先使用 Cursor Bot 评论模式；其他情况在修改仓库状态前提出一个简短的澄清问题。

## 共同约束

- 只在用户指定的仓库中工作。执行任何会改变仓库状态的命令前，先确认仓库根目录。
- 保护用户未提交的工作，并始终遵守下方 Git 安全红线。用户调用本 skill 不代表授权执行任何危险 Git 操作。
- 改变仓库状态的 Git 命令按阶段执行。前置条件失败、分支匹配不唯一、pull 失败或 merge 冲突时立即停止，并说明失败阶段与安全的下一步。merge 冲突时还要列出冲突文件，给出逐文件检查、定向暂存、验证、手动完成 merge commit 和续跑流程的建议，但不得替用户自动处理或提交。
- 用户显式调用“转测”或“提单”，即授权执行交付流程中规定的分支切换、merge 和普通 push；这**不授权** force-push、直接提交 GitHub PR、合并远程 PR 或进行无关修改。
- 交付模式最终只生成预填充的 GitHub compare URL 和本地 PR 草稿，不提交 PR。用户显式提供需求 ID 时，需求分支可以 `feature`、`fix` 或 `bugfix` 开头；未提供时只接受当前本地 `feature/<username>/[<功能简写>/]<需求ID>` 分支。具体匹配与 Release 日期复用规则以交付参考文件为准。生成前先用 `⏳` 进度消息告知用户；成功后把本地仓库切回匹配的需求分支。
- 代码审查模式不得修改代码。Cursor Bot 评论模式先分析并提出方案，等待用户确认后再实施。
- 优先使用随 skill 提供的 Node.js 脚本完成确定性检查、可续跑分支准备、提交解析和 PR 正文生成。脚本要求 Node.js 16+，仅使用标准库，并把临时状态保存在 `.git/pr-helper/`。草稿生成脚本的控制台只输出精简摘要；从摘要中的 `result_path` 读取完整 compare URL 与提交信息，不要把完整结果 JSON 回显到 Codex 或 Cursor 控制台。

## Git 安全红线

以下限制适用于所有模式。即使用户要求，`pr-helper` 也不得执行；应停止并说明风险，由用户在本 skill 流程外自行处理：

1. **禁止删除分支或引用。** 不得执行 `git branch -d/-D`、`git push --delete`、`git push <remote> :<branch>`、`git update-ref -d`，也不得用其他等效方式删除本地或远程分支、Tag 或 Git 引用。
2. **禁止改写、回退或重放历史。** 不得执行 `git rebase`、`git reset`、`git revert`、`git commit --amend`、`git cherry-pick`、`git filter-branch`、`git filter-repo`、`git replace`、`git branch -f`、`git switch -C` 或 `git checkout -B`。
3. **禁止任何强制或批量推送。** 不得使用 `git push --force`、`-f`、`--force-with-lease`、`--force-if-includes`、`--mirror`、`--all`、`--tags`，只允许向脚本确定的交付分支执行普通 push。
4. **禁止丢弃、隐藏或覆盖工作区内容。** 不得执行 `git restore`、`git checkout -- <path>`、`git clean`、`git stash`、`git rm`，也不得直接删除或覆盖工作区、暂存区、`.git`、reflog 或对象数据库中的内容。
5. **禁止擅自中止或处理冲突。** merge 冲突时保留现场并立即停止；不得执行 `git merge --abort`，不得自动选择 ours/theirs、自动提交冲突结果或绕过用户确认。只有用户明确授权协助解决具体冲突后，才可编辑冲突文件，但仍不得违反其他安全红线。
6. **禁止修改仓库身份、远程与安全配置。** 不得执行 `git config`、增删或改写 remote、修改凭据、Hooks、签名配置、分支保护相关设置，也不得使用 `--no-verify`、`--no-gpg-sign` 等参数绕过校验。
7. **禁止直接推送受保护基础分支。** 不得向 `master`、`main`、`test`、`develop`、`pre_release` 等基础分支直接 push；只允许拉取并以 `--ff-only` 更新本地基础分支。
8. **禁止夹带无关变更。** 不得运行宽泛的 `git add -A`、`git add .` 或独立的 `git commit` 来提交用户工作区内容；交付流程只允许脚本执行必要的 merge commit。
9. **禁止在前置状态异常时继续。** 工作区不干净、存在未推送提交、处于 detached HEAD、已有 merge/rebase/cherry-pick 等进行中操作、上游缺失或分支匹配不唯一时，必须停止，不得用临时命令规避检查。
10. **限制变更仓库状态的操作范围。** 只允许交付脚本规定的分支切换或创建、`git pull --ff-only`、同一脚本显式 fetch 后基于 `origin/<branch>` 的 `git merge --ff-only`、普通 merge、普通 push，以及只读检查和 `git fetch`；任何未在流程中明确列出的变更操作都应先停止。

## 输出要求

代码审查与 Bot 评论分析应先给出按严重程度排序的问题，并引用文件与行号证据。交付模式应报告已完成阶段、已切回的需求分支、比较方向、带 `quick_pull=1`、`title`、`body` 参数的 compare URL、草稿位置、完整结果位置以及用户需要执行的操作。必须等待草稿生成脚本成功退出并完成回切后，再从精简摘要的 `result_path` 读取完整结果；不要在 commentary 或工具命令中 `cat`、打印或预览完整结果 JSON。先输出其余交付信息，把 compare URL 包装成 Markdown 链接作为最终回复的最后一行，输出链接后立即结束回复，避免长链接被中间过程重复渲染。如果没有发现问题，应明确说明，并指出未能验证的测试或证据。
