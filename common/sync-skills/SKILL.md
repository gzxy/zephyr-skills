---
name: sync-skills
description: |
  同步团队共享的 Cursor Skills 到个人目录。用于以下场景：
  - "同步skills" / "同步所有skills" - 全量同步（公共 + 所有项目）
  - "同步公共skills" - 仅同步公共 skills
  - "同步 {项目名} 的skills" - 同步公共 + 指定项目的 skills
  - "同步 {项目A} 和 {项目B} 的skills" - 同步公共 + 多个项目
  - "同步 {skillA} 和 {skillB}" - 按名称挑选同步指定 skills
  - "查看skills" / "列出skills" - 查看共享仓库中有哪些可用的 skills
  - "初始化skills" / "setup skills" - 首次克隆共享仓库并安装
---

# Sync Skills

将团队共享 Git 仓库中的 Skills 全量或按需同步到当前用户的 `~/.cursor/skills/` 目录。

## 配置

| 变量 | 值 | 说明 |
|------|-----|------|
| `REPO_URL` | `git@github.com:gzxy/zephyr-skills.git` | 共享仓库地址 |
| `LOCAL_CACHE` | `~/.cursor/skills-repo` | 本地缓存克隆位置 |
| `SKILLS_DIR` | `~/.cursor/skills` | 个人 skills 安装目录 |

> 如果团队仓库地址有变更，修改本文件中的 `REPO_URL` 即可。

## 仓库结构说明

```
zephyr-skills/
├── common/              ← 公共 skills，所有项目通用
│   ├── sync-skills/
│   │   └── SKILL.md
│   └── .../
├── projects/            ← 按项目分组的 skills
│   ├── backend/
│   │   ├── branch-workflow/
│   │   │   └── SKILL.md
│   │   ├── pr-creator/
│   │   │   └── SKILL.md
│   │   └── .../
│   ├── another-project/
│   │   └── .../
│   └── .../
├── setup.sh
└── README.md
```

## 操作流程

### 步骤1：拉取共享仓库最新代码

```bash
REPO_URL="git@github.com:gzxy/zephyr-skills.git"
LOCAL_CACHE="$HOME/.cursor/skills-repo"
```

检查 `$LOCAL_CACHE` 是否存在：

- **已存在**：拉取最新代码
```bash
cd "$LOCAL_CACHE" && git pull origin master
```

- **不存在**：首次克隆
```bash
git clone "$REPO_URL" "$LOCAL_CACHE"
```

如果 clone 或 pull 失败，提示用户检查：
1. 是否有仓库访问权限（SSH key 配置）
2. 仓库地址是否正确
3. 网络是否可达

### 步骤2：探查仓库内容

列出所有可用的公共 skills 和项目：

```bash
echo "=== 公共 skills ==="
ls "$LOCAL_CACHE"/common/

echo "=== 项目列表 ==="
ls "$LOCAL_CACHE"/projects/

echo "=== 各项目 skills ==="
for p in "$LOCAL_CACHE"/projects/*/; do
  echo "[$(basename "$p")]"
  ls "$p"
done
```

### 步骤3：解析同步范围

根据用户指令，按优先级匹配同步模式：

#### 模式1：全量同步
**触发**：用户说"同步所有skills"、"全量同步skills"、"同步skills"（未指定范围）

```bash
TARGET="$HOME/.cursor/skills"
mkdir -p "$TARGET"

# 同步公共 skills
cp -r "$LOCAL_CACHE"/common/* "$TARGET/"

# 同步所有项目 skills
for project_dir in "$LOCAL_CACHE"/projects/*/; do
  cp -r "$project_dir"* "$TARGET/"
done
```

#### 模式2：仅公共
**触发**：用户说"同步公共skills"

```bash
cp -r "$LOCAL_CACHE"/common/* "$TARGET/"
```

#### 模式3：公共 + 指定项目（支持多个）
**触发**：用户说"同步 backend 的skills"或"同步 backend 和 frontend 的skills"

从用户指令中提取项目名列表，与 `projects/` 下的目录名进行模糊匹配。

```bash
# 始终同步公共 skills
cp -r "$LOCAL_CACHE"/common/* "$TARGET/"

# 同步匹配到的每个项目
for project in ${MATCHED_PROJECTS}; do
  if [ -d "$LOCAL_CACHE/projects/$project" ]; then
    cp -r "$LOCAL_CACHE/projects/$project"/* "$TARGET/"
  else
    echo "⚠️ 项目 '$project' 不存在，跳过"
  fi
done
```

如果匹配不到任何项目，列出所有可用项目让用户选择。

#### 模式4：按 skill 名称指定（支持多个、跨项目）
**触发**：用户说"同步 branch-workflow 和 pr-creator"、"只同步 sync-skills"

从用户指令中提取 skill 名称列表，在 `common/` 和 `projects/*/` 下全局搜索。

```bash
locate_skill() {
  local name="$1"
  # 先查 common
  if [ -d "$LOCAL_CACHE/common/$name" ]; then
    echo "$LOCAL_CACHE/common/$name"
    return
  fi
  # 再查所有 projects
  for project_dir in "$LOCAL_CACHE"/projects/*/; do
    if [ -d "$project_dir$name" ]; then
      echo "$project_dir$name"
      return
    fi
  done
  echo "NOT_FOUND"
}

for skill_name in ${MATCHED_SKILLS}; do
  skill_path=$(locate_skill "$skill_name")
  if [ "$skill_path" != "NOT_FOUND" ]; then
    cp -r "$skill_path" "$TARGET/"
  else
    echo "⚠️ Skill '$skill_name' 不存在，跳过"
  fi
done
```

#### 模式5：混合模式（项目 + 指定 skill）
**触发**：用户同时提到项目名和 skill 名，如"同步 backend 项目的和 some-other-skill"

组合执行模式3和模式4的逻辑。

### 步骤4：验证并输出同步报告

```bash
ls -la "$HOME/.cursor/skills/"
```

按以下格式输出：

**全量同步报告：**
```
✅ Skills 同步完成！
📦 仓库：git@github.com:gzxy/zephyr-skills.git
📂 同步范围：全量（公共 + 所有项目）
🔄 同步 skills 列表：
  [公共]
  - sync-skills
  [backend]
  - branch-workflow
  - pr-creator
📁 安装路径：~/.cursor/skills/
🔢 共同步 N 个 skills
```

**指定项目同步报告：**
```
✅ Skills 同步完成！
📦 仓库：git@github.com:gzxy/zephyr-skills.git
📂 同步范围：公共 + backend
🔄 同步 skills 列表：
  [公共]
  - sync-skills
  [backend]
  - branch-workflow
  - pr-creator
📁 安装路径：~/.cursor/skills/
🔢 共同步 N 个 skills
```

**按名称指定同步报告：**
```
✅ Skills 同步完成！
📦 仓库：git@github.com:gzxy/zephyr-skills.git
📂 同步范围：指定 skills
🔄 同步 skills 列表：
  - branch-workflow（来自 projects/backend）
  - sync-skills（来自 common）
📁 安装路径：~/.cursor/skills/
🔢 共同步 N 个 skills
```

## 仅查看可用 skills（不执行同步）

如果用户只是想查看有哪些 skills，执行步骤1和步骤2后，按以下格式输出，不执行复制：

```
📋 共享仓库可用 skills 列表：

[公共 - common/]
  - sync-skills：同步团队共享 Skills

[项目 - backend/]
  - branch-workflow：开发分支管理工作流
  - pr-creator：PR 自动化流程助手

如需同步，请指定范围，例如：
  - "同步所有skills" - 全量同步
  - "同步 backend 的skills" - 同步公共 + backend 项目
  - "同步 branch-workflow" - 仅同步指定 skill
```

## 注意事项

- 同步是**覆盖式**：共享仓库中的 skill 会覆盖个人目录中同名的 skill
- 个人独有的 skill（不在共享仓库中的）**不会被删除**
- sync-skills 自身也在共享仓库中，同步时会自我更新
- 首次使用前需确保有共享仓库的 Git 访问权限
- skill 目录名**全局唯一**，避免 common 和不同 projects 下出现同名 skill
