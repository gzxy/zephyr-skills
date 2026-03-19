---
name: branch-workflow
description: |
  开发分支管理工作流，涵盖完整的分支生命周期。用于以下场景：
  - "创建开发分支" / "新建feature分支" - 从master创建feature分支（步骤1）
  - "提测试" / "提test的pr" / "创建test PR" - 合并到develop + 创建临时分支 + 提PR到test（步骤2）
  - "提预发布" / "提pre_release的pr" / "创建预发布PR" - 创建release分支 + 创建临时分支 + 提PR到pre_release（步骤3）
  - "创建release分支" / "发布分支" - 单独基于master创建release分支并合并feature分支（步骤4）
  - "分支管理" / "分支流程" / "开发流程" - 通用分支管理操作
---

# Branch Workflow

开发分支管理SOP，共4个步骤。用户会指定要执行哪个步骤。

## 前置信息收集

每个步骤开始前，获取以下信息：
```bash
git config user.name          # git用户名
git branch --show-current     # 当前分支
git remote -v                 # remote信息
```

向用户确认 **TAPD任务编号**（如果未提供）。

从当前 feature 分支名中提取信息（格式：`feature/{name}/{tapd_id}`）：
- `{name}`：用户名或缩写（如 `wpf`）
- `{tapd_id}`：TAPD 任务编号（如 `1044036`）

## 步骤1：创建开发分支

```bash
git checkout master
git pull origin master
git checkout -b feature/{git用户名}/{tapd任务编号}
git push -u origin feature/{git用户名}/{tapd任务编号}
```

## 步骤2：提测试PR

完整流程分两个阶段：创建临时分支 → 提 PR 到 test。

<!-- [暂时禁用] 阶段一：合并 feature 到 develop
原因：develop 与 master 基线差异较大，冲突过多，待处理后再放开。

```bash
git fetch origin develop
git checkout develop
git pull origin develop
git merge feature/{name}/{tapd_id}
```

- 如果 merge 有冲突，**立即停止**，提醒用户手动解决冲突。用户确认解决后，继续执行 push 及后续阶段。
- 无冲突则推送到远端：
```bash
git push origin develop
```
-->

### 阶段一：基于 test 创建临时分支

生成当前时间戳（格式：YYYYMMDDHHmm，如 202602081951）。

```bash
git checkout test
git pull origin test
git checkout -b tmp_feature/{name}/{tapd_id}_{时间戳}
git merge feature/{name}/{tapd_id}
```

- 如果 merge 有冲突，**立即停止**，提醒用户手动解决冲突。用户确认解决后，继续执行 push 及后续阶段。
- 无冲突则：
```bash
git push -u origin tmp_feature/{name}/{tapd_id}_{时间戳}
```

### 阶段二：提 PR 到 test

使用 GitHub CLI 创建 PR：

```bash
gh pr create \
  --base test \
  --head tmp_feature/{name}/{tapd_id}_{时间戳} \
  --title "【测试】{简要描述}" \
  --body "{PR正文}"
```

**PR正文必须严格按本 skill 下方定义的完整格式生成**，不得省略任何 section（含改动范围表格、代码审查、质量评分）。

自动生成PR内容的流程：
1. 读取 `.github/PULL_REQUEST_TEMPLATE.md` 模板
2. 执行 `git log test..HEAD --oneline` 获取commit列表
3. 执行 `git diff test...HEAD --stat` 获取变更文件概览
4. 执行 `git diff test...HEAD` 获取详细变更内容
5. 根据变更内容自动总结填充模板各项：
   - **变更说明**：从commit message和diff中提取TAPD链接，总结变更目的
   - **描述**：分析代码变更，总结修改了哪些模块、做了什么、为什么改；在描述末尾附上【改动范围表格】，格式：`文件路径 | 变更类型 | 主要改动`
   - **如何进行测试**：根据变更的模块和功能，推荐测试场景
   - **影响**：分析是否涉及接口变更、数据库变更、新依赖等客观影响
   - **清单**：默认全部勾选
   - **代码审查**（新增 section，追加在清单之后，内容不与上述各项重复）：
     - `## ✅ 优点`：列举本次变更值得肯定的地方（健壮性、架构、可读性等）
     - `## ⚠️ 问题清单`：分两级列出，若无则写"无"
       - `### 🔴 高优先级（必须修复）`：影响正确性或稳定性的问题，注明文件+行号+问题描述+修改建议
       - `### 🟡 中优先级（建议修复）`：代码风格、可维护性等问题，注明文件+行号+问题描述+修改建议
     - `## 📊 质量评分`：对功能正确性、代码健壮性、可维护性、性能四个维度用 ⭐（1-5颗）打分，并给出综合评分

不需要向用户收集信息，直接根据代码变更自动生成。**输出时必须包含上述所有 section，包括改动范围表格和代码审查（优点、问题清单、质量评分）。**

## 步骤3：提预发布PR

完整流程分四个阶段：创建 release 分支 → 合并到 release → 创建临时分支 → 提 PR 到 pre_release。

### 阶段一：从 origin/master 创建 release 分支

生成当天日期（格式：YYYYMMDD，如 20260318）。
从当前 feature 分支名提取 `{name}` 和 `{tapd_id}`。

```bash
git fetch origin master
git checkout -b release/{name}/{当天日期}/{tapd_id} origin/master
```

### 阶段二：合并 feature 到 release 并推送

```bash
git merge feature/{name}/{tapd_id}
```

- 如果 merge 有冲突，**立即停止**，提醒用户手动解决冲突。用户确认解决后，继续执行 push 及后续阶段。
- 无冲突则推送到远端：
```bash
git push -u origin release/{name}/{当天日期}/{tapd_id}
```

### 阶段三：基于 pre_release 创建临时分支

生成当前时间戳（格式：YYYYMMDDHHmm）。

```bash
git checkout pre_release
git pull origin pre_release
git checkout -b tmp_release/{name}/{tapd_id}_{时间戳}
git merge feature/{name}/{tapd_id}
```

- 如果 merge 有冲突，**立即停止**，提醒用户手动解决冲突。用户确认解决后，继续执行 push 及后续阶段。
- 无冲突则：
```bash
git push -u origin tmp_release/{name}/{tapd_id}_{时间戳}
```

### 阶段四：提 PR 到 pre_release

使用 GitHub CLI 创建 PR：

```bash
gh pr create \
  --base pre_release \
  --head tmp_release/{name}/{tapd_id}_{时间戳} \
  --title "【预发布】{简要描述}" \
  --body "{PR正文}"
```

**PR正文必须严格按本 skill 下方定义的完整格式生成**，不得省略任何 section（含改动范围表格、代码审查、质量评分）。

自动生成PR内容的流程：
1. 读取 `.github/PULL_REQUEST_TEMPLATE.md` 模板
2. 执行 `git log pre_release..HEAD --oneline` 获取commit列表
3. 执行 `git diff pre_release...HEAD --stat` 获取变更文件概览
4. 执行 `git diff pre_release...HEAD` 获取详细变更内容
5. 根据变更内容自动总结填充模板各项：
   - **变更说明**：从commit message和diff中提取TAPD链接，总结变更目的
   - **描述**：分析代码变更，总结修改了哪些模块、做了什么、为什么改；在描述末尾附上【改动范围表格】，格式：`文件路径 | 变更类型 | 主要改动`
   - **如何进行测试**：根据变更的模块和功能，推荐测试场景
   - **影响**：分析是否涉及接口变更、数据库变更、新依赖等客观影响
   - **清单**：默认全部勾选
   - **代码审查**（新增 section，追加在清单之后，内容不与上述各项重复）：
     - `## ✅ 优点`：列举本次变更值得肯定的地方（健壮性、架构、可读性等）
     - `## ⚠️ 问题清单`：分两级列出，若无则写"无"
       - `### 🔴 高优先级（必须修复）`：影响正确性或稳定性的问题，注明文件+行号+问题描述+修改建议
       - `### 🟡 中优先级（建议修复）`：代码风格、可维护性等问题，注明文件+行号+问题描述+修改建议
     - `## 📊 质量评分`：对功能正确性、代码健壮性、可维护性、性能四个维度用 ⭐（1-5颗）打分，并给出综合评分

PR正文**必须**与步骤2格式完全一致，包含所有 section（改动范围表格、代码审查、质量评分），不得省略。

不需要向用户收集信息，直接根据代码变更自动生成。

### 最终输出

所有步骤（步骤2、步骤3）PR 创建完成后，**必须使用 markdown 链接语法展示 PR 链接**，格式为 `[完整URL](完整URL)`，确保可点击跳转且显示完整链接。

步骤2（测试PR）输出格式：
```
✅ 测试 PR 已创建：[https://github.com/xxx/pull/123](https://github.com/xxx/pull/123)
📋 临时分支：`tmp_feature/{name}/{tapd_id}_{时间戳}` → `test`
```

步骤3（预发布PR）输出格式，额外展示 release 分支名：
```
✅ 预发布 PR 已创建：[https://github.com/xxx/pull/123](https://github.com/xxx/pull/123)
📦 Release 分支：`release/{name}/{当天日期}/{tapd_id}`
📋 临时分支：`tmp_release/{name}/{tapd_id}_{时间戳}` → `pre_release`
```

## 步骤4：单独创建 release 分支

> 通常不需要单独执行此步骤，步骤3（提预发布PR）会自动创建 release 分支。仅当需要单独创建时使用。

前置检查：当前分支必须是开发分支（匹配 `feature/{name}/*` 格式）。如果不是，**立即停止**，告知用户先切换到对应的开发分支。

从当前开发分支名中提取 `{name}` 和 `{tapd_id}`。

生成当天日期（格式：YYYYMMDD，如 20260208）。

```bash
git checkout master
git pull origin master
git checkout -b release/{name}/{当天日期}/{tapd_id}
git merge feature/{name}/{tapd_id}
```

- 如果 merge 有冲突，**立即停止**，提醒用户手动解决冲突。用户确认解决后，继续执行 push。
- 无冲突则：
```bash
git push -u origin release/{name}/{当天日期}/{tapd_id}
```

## PR 正文模板

步骤2和步骤3的 PR 正文**必须**按以下完整格式输出，所有 section 均不可省略：
```
# 变更说明
TAPD：{tapd链接}
{变更目的简述}

# 描述
{变更背景和原因}

**改动范围：**
| 文件路径 | 变更类型 | 主要改动 |
|---------|---------|---------|
| `{文件}` | {类型} | {说明} |

{其他重要细节}

# 如何进行测试？
场景1：{...}
场景2：{...}

# 影响
- {客观影响说明}

# 清单
- [x] 我的代码符合项目的编码和风格指南
- [x] 我已经对我的代码进行了自我审查
- [x] 我已对我的代码进行了注释，特别是在难以理解的部分
- [x] 已更新接口文档和README
- [x] Commit 信息规范（feat/fix/refactor，描述了相关更改以及原因）
- [x] 我的修改不会产生新的警告
- [x] 我已完成功能自测
- [x] 我已经评估了该特性的性能影响
- [x] 无调试代码（console.log、print 等）
- [x] 已通知测试团队准备测试

# 代码审查

## ✅ 优点
- {优点1}
- {优点2}

## ⚠️ 问题清单

### 🔴 高优先级（必须修复）
> 若无则填：无

1. **{问题标题}**
   - 位置：`{文件路径}` 第 {行号} 行
   - 问题：{具体描述}
   - 建议：{修改建议}

### 🟡 中优先级（建议修复）
> 若无则填：无

1. **{问题标题}**
   - 位置：`{文件路径}` 第 {行号} 行
   - 问题：{具体描述}
   - 建议：{修改建议}

## 📊 质量评分

| 维度 | 评分 |
|------|------|
| 功能正确性 | ⭐⭐⭐⭐☆ |
| 代码健壮性 | ⭐⭐⭐⭐☆ |
| 可维护性 | ⭐⭐⭐☆☆ |
| 性能 | ⭐⭐⭐⭐⭐ |

**综合评分**：⭐⭐⭐⭐☆ (4/5)
```

## 注意事项

- **提 PR 时（步骤2、步骤3）必须按 skill 定义的完整格式生成 PR 正文**，包含：变更说明、描述+改动范围表格、测试、影响、清单、代码审查（优点、问题清单、质量评分）
- 永远不要使用 `git reset --hard` 或 `git checkout --` 等破坏性命令
- 不要尝试自动解决冲突，必须等用户手动处理
- 所有 git 操作前先确认当前分支状态
- 推送分支后告知用户分支名和远程URL
- **步骤2**的 feature→develop 合并已暂时禁用（develop 与 master 基线差异大，冲突过多），待处理后在 skill 中取消注释即可恢复
- **步骤3**执行前会自动从 origin/master 创建 release 分支并合并 feature，完成后展示 release 分支名
