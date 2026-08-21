# 交付 PR 模式

在目标仓库内运行 `../scripts/` 中的辅助脚本。脚本要求 Node.js 16+，仅使用 Node.js 标准库。可续跑检查点、生成的草稿与完整 PR 结果保存在 `.git/pr-helper/`，因此不会把流程状态加入业务工作区。

整个流程必须遵守主 `SKILL.md` 的“Git 安全红线”。脚本失败时不得用被禁止的 Git 命令绕过检查或强行继续。

两种模式都可以省略需求 ID：

```text
/pr-helper 转测
/pr-helper 提单
/pr-helper 转测 3412341
/pr-helper 提单 3412341
```

先确定需求 ID 和需求分支：

- 用户提供纯数字需求 ID 时，使用该 ID，后续分支查找与原流程一致。
- 用户未提供需求 ID 时，只使用当前本地分支。前置检查脚本会先读取当前分支；它必须严格符合 `feature/<username>/<需求ID>` 或 `feature/<username>/<功能简写>/<需求ID>`，并以末尾的纯数字段作为需求 ID。不接受 `fix`、需求 ID 后缀、额外层级、detached HEAD 或其他分支。
- 未提供 ID 且当前分支不符合格式时，立即退出整个交付流程并报告原因。不要搜索其他本地或远程分支，不要猜测需求 ID，也不要继续 fetch、写检查点或执行任何改变仓库状态的操作。
- 从当前分支推断时，把该分支作为本次唯一的需求分支；即使存在相同 ID 的其他分支，也不进入多候选选择。

模式映射如下：

- “转测”使用 `--mode test`。
- “提单”使用 `--mode release`。

## 阶段一：前置检查

运行：

```bash
node <skill目录>/scripts/preflight.mjs --mode <test|release> [--request-id <需求ID>]
```

如果用户未提供需求 ID，不要替它补上 `--request-id`；让脚本从当前分支推断并输出最终采用的需求 ID。记录脚本输出的需求 ID，后续阶段都显式传入该 ID。

该阶段验证以下条件：

- 当前目录位于 Git 仓库中；
- 未提供需求 ID 时，当前本地分支符合规定格式，并从中提取需求 ID；该检查先于远程检查、fetch 和检查点写入；
- 存在 `origin` 远程；
- 工作区、暂存区和未跟踪文件均为空；
- 当前分支已配置上游，且没有尚未推送的本地提交。

脚本始终执行 `git fetch origin`，不允许跳过；兼容旧调用的 `--fetch` 参数可以保留，但不影响强制 fetch 行为。任何检查失败都应停止，并把脚本给出的修复方法转述给用户。

## 阶段二：查找并同步需求分支

运行：

```bash
node <skill目录>/scripts/sync-feature.mjs --mode <test|release> --request-id <已确定的需求ID>
```

用户未提供需求 ID 时，脚本使用前置检查点记录的当前分支，相当于自动指定该完整分支，不搜索或选择其他候选。用户显式提供需求 ID 时，继续使用以下原有查找规则。

分支必须在本地或 `origin` 下符合以下任一格式，开头可以是 `feature`、`fix` 或 `bugfix`：

```text
<feature|fix|bugfix>/<username>/<需求ID>
<feature|fix|bugfix>/<username>/<需求ID><非数字开头的后缀>
<feature|fix|bugfix>/<username>/<功能简写>/<需求ID>
<feature|fix|bugfix>/<username>/<功能简写>/<需求ID><非数字开头的后缀>
```

需求 ID 后若有后缀，后缀的第一个字符必须不是数字，以免把其他更长的数字 ID 错判为当前需求。

- 没有匹配时终止流程；
- 只有一个匹配时切换到该分支，并使用 `--ff-only` 更新；
- 有多个匹配时不得猜测，列出候选项并请用户选择，然后追加 `--branch <完整分支名>` 重试；
- 需求分支仅存在于本地或包含未推送提交时终止流程，先要求用户推送。

## 阶段三：准备交付分支

### 转测

运行：

```bash
node <skill目录>/scripts/prepare-delivery.mjs --mode test --request-id <需求ID>
```

脚本更新或从 `test` 创建 `tmp_feature/<username>/[<功能简写>/]<需求ID>[后缀]`，合并需求分支，然后普通推送临时转测分支到 `origin`。`tmp_feature` 会保留需求分支中开头之后的完整相对路径；`bugfix/alice/pay/123-fix` 对应 `tmp_feature/alice/pay/123-fix`。

### 提单

运行：

```bash
node <skill目录>/scripts/prepare-delivery.mjs --mode release --request-id <需求ID>
```

脚本依次执行：

1. 从需求分支解析 `username` 与需求 ID，查找 `release/<username>/<YYYYMMDD>/<需求ID>`；
2. 若没有匹配分支，以当天日期从 `master` 创建；若只有一个则复用；若有多个日期则复用日期最新的分支；
3. 合并需求分支并普通推送 Release 分支；
4. 使用 `tmp_` 直接拼接选中的 Release 分支名，得到 `tmp_release/<username>/<YYYYMMDD>/<需求ID>`，再从 `pre_release` 创建或更新、合并 Release 分支并普通推送。

用户明确要求“不复用已有日期”或“创建新的日期”时，为准备命令追加 `--new-release-date`。此时使用当天日期；若当天分支已经存在，则仍复用当天分支。

准备交付前必须再次 fetch origin、以 `--ff-only` 同步需求分支，并记录最新需求分支 SHA；因此即使从 `feature_synced` 检查点续跑，也不会合并旧提交。该脚本完成显式 fetch 后，需求分支、基础分支和已有交付分支都使用刚更新的本地 `origin/<branch>` 引用执行 `git merge --ff-only`，不要再为每个分支执行会重复联网的 `git pull`。即使检查点记录阶段已完成，脚本也会验证远程交付分支是否包含来源分支的最新提交；来源分支有新增提交时，该阶段及其下游阶段会失效并重新合并、推送。

发生 merge 冲突时，脚本保留冲突现场并退出。首次合并失败以及冲突现场下的后续重试，都要列出冲突文件并给出以下处理建议：

1. 用 `git status --short` 确认冲突类型和当前 merge 状态；
2. 逐个理解两侧改动并编辑为最终内容，不要批量选择 ours/theirs；
3. 每解决一个文件，由用户手动运行 `git add -- <冲突文件路径>`，不要使用 `git add .` 或 `git add -A`；
4. 运行 `git diff --check`、`git diff --cached --check` 和相关测试，再用 `git diff --name-only --diff-filter=U` 确认没有未解决文件；
5. 用户确认结果后手动运行 `git commit` 完成当前 merge commit，再重新运行相同的 `prepare-delivery.mjs` 命令续跑。

这些内容只是安全的处理建议。PR Helper 仍然不得自动选择冲突一侧、自动编辑或暂存冲突文件、自动提交、自动执行 `git merge --abort`，也不得用 reset、checkout、restore 等方式清理现场。用户明确授权协助解决具体冲突文件后，可以分析两侧差异并编辑文件，但暂存和提交仍由用户完成。

## 阶段四：生成 compare URL 与 PR 草稿

运行生成命令前，先在 agent 会话中发送一条独立的进度消息：

```text
⏳ PR compare 链接生成中…
```

不要等到生成完成后再补发这条消息，也不要把它仅写进最终总结。

运行其中一个命令：

```bash
node <skill目录>/scripts/build-pr-draft.mjs --mode test --request-id <需求ID>
node <skill目录>/scripts/build-pr-draft.mjs --mode release --request-id <需求ID>
```

比较方向为：

- 转测：`tmp_feature/**/<需求ID> -> test`；
- 提单：`tmp_release/**/<需求ID> -> pre_release`。

脚本读取相应 `origin/<目标>..origin/<来源>` 范围内的普通提交，忽略 merge commit，并只保留包含匹配 `--story=<需求ID>@...` 元数据的提交。解析规则如下：

- **关联需求描述：** 从 `--story` 到提交信息末尾；
- **diff 变更描述：** `--story` 前的文本，规范为单行，并移除开头的 `feat:` 或 `fix:`（不区分大小写）；移除后为空的描述直接忽略，不生成空列表项；
- **需求名称：** `--user=<姓名>` 之后、最后一个 HTTP(S) URL 之前的文本。

脚本优先读取业务仓库的 `.github/PULL_REQUEST_TEMPLATE.md`；若业务仓库没有该文件，则读取 skill 内置的 `references/pull-request-template.md` 作为兜底模板。业务模板始终优先，只有两处模板都不存在时才停止。随后执行以下修改：

- 替换“变更说明”章节；
- 以无序列表替换“描述”章节；
- 勾选“清单”章节内的所有任务项；
- 保留其他章节原样。

标题分别为 `【测试】<需求名称>` 和 `【预发布】<需求名称>`。compare URL 必须使用 `quick_pull=1`，并携带经过 URL 编码的 `title` 与 `body` 参数，使 GitHub 页面直接进入创建 PR 状态并填充标题、模板正文。PR 正文写入 `.git/pr-helper/drafts/`，包含完整 compare URL、提交元数据和草稿位置的结构化结果写入 `.git/pr-helper/results/<mode>-<需求ID>.json`。

生成脚本的 stdout 只输出精简 JSON 摘要，包含 `title`、`base`、`head`、`draft_path`、`result_path`、`checkpoint`、`commit_count`、`current_branch` 和 `submitted`，不直接打印超长 `compare_url`、PR 正文或完整提交数组。这可以避免 Codex 与 Cursor 在工具执行期间重复传输和渲染长 URL。

只有遗留集成或诊断工具确实依赖旧版完整 stdout JSON 时，才为生成命令追加 `--full-output`。该兼容参数会输出完整结果，包括 `compare_url` 和提交数组；Codex 与 Cursor 的正常交付流程不要使用它。

脚本成功退出后，从摘要的 `result_path` 读取完整结果。优先使用结构化文件读取能力，不要用 `cat` 或等效命令把整个结果 JSON 打到控制台；只提取最终回复需要的字段，并把 `compare_url` 留到最终回复的最后一行输出。完整结果文件是生成命令的权威输出，检查点中的 `draft.result_path` 应与其一致。

如果没有匹配提交、业务与兜底模板都不存在、模板缺少必要章节或无法解析需求名称，应停止并向用户索取缺失信息，不得编造 PR 内容。没有可用的 diff 变更描述不属于错误，“描述”章节可以为空。

链接、草稿和完整结果成功生成后，脚本会把本地仓库切回本次流程匹配的 `feature`、`fix` 或 `bugfix` 需求分支。只有回切成功，且精简摘要、完整结果、草稿和检查点互相一致，才视为整个转测或提单流程完成；失败时报告当前分支和错误，不要宣称流程已完成。

脚本执行期间不要在会话中提前输出、拼接或预览 compare URL。等待脚本成功退出，并确认草稿、检查点和需求分支回切均已完成后，才可在最终回复中给出链接。

## 继续与重试

用户说“继续”或“重试”时，检查：

- `.git/pr-helper/<mode>-<需求ID>.json`；
- `git status`；
- 当前分支；
- 是否存在 `MERGE_HEAD`。

从第一个未完成阶段继续。不得盲目重做已完成的 merge，不得自动 abort 冲突，不得使用强制操作。已完成阶段仅在远程交付分支仍存在且包含来源分支最新提交时跳过；远程分支消失或来源分支新增提交时，脚本会将该阶段及其下游阶段视为失效并重新准备。

## 完成输出

返回以下信息：

- PR 标题；
- base/head 分支；
- compare URL；
- 草稿路径；
- 完整结果路径；
- 已切回的需求分支；
- 关联提交简表。

明确说明 PR 尚未提交，用户需要检查预填充页面后自行创建。先输出上述状态与说明，再把完整 compare URL 包装成 Markdown 链接，作为最终回复的最后一个非空行；链接后不要继续输出任何文字，使链接出现时回复已完成渲染并可立即点击。
