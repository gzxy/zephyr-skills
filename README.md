# Zephyr Skills

团队共享的 Cursor Agent Skills 仓库。统一管理、版本控制、一键同步到个人环境。

## 仓库结构

```
zephyr-skills/
├── common/                  ← 公共 skills（所有项目通用）
│   └── sync-skills/         ← Skills 同步工具（自举更新）
│       └── SKILL.md
├── projects/                ← 按项目分组
│   └── backend/             ← 后端项目专属
│       ├── branch-workflow/ ← 分支管理工作流
│       │   └── SKILL.md
│       └── pr-creator/      ← PR 自动化助手
│           ├── SKILL.md
│           └── scripts/
├── setup.sh                 ← 一键初始化脚本
└── README.md
```

- **`common/`**：所有项目通用的 skills，同步时默认安装
- **`projects/{项目名}/`**：特定项目专属的 skills，按需安装
- Skill 目录名**全局唯一**，最终都安装到 `~/.cursor/skills/` 扁平目录下

## 快速开始

### 首次安装

```bash
# 全量安装（公共 + 所有项目）
bash <(curl -sSL https://raw.githubusercontent.com/gzxy/zephyr-skills/master/setup.sh)

# 或者手动执行
git clone git@github.com:gzxy/zephyr-skills.git ~/.cursor/skills-repo
cd ~/.cursor/skills-repo
bash setup.sh
```

### 按需安装

```bash
bash setup.sh                      # 全量：公共 + 所有项目
bash setup.sh common               # 仅公共 skills
bash setup.sh backend              # 公共 + backend 项目
bash setup.sh backend frontend     # 公共 + 多个项目
```

### 后续更新

安装完成后，在任意项目的 Cursor 中对 AI 说：

| 你说 | 效果 |
|------|------|
| "同步skills" 或 "同步所有skills" | 全量同步（公共 + 所有项目） |
| "同步公共skills" | 仅同步公共 skills |
| "同步 backend 的skills" | 同步公共 + backend 项目 |
| "同步 backend 和 frontend 的skills" | 同步公共 + 多个项目 |
| "同步 branch-workflow 和 pr-creator" | 按名称指定同步（自动定位来源） |
| "查看skills" 或 "列出skills" | 查看可用 skills 列表（不安装） |

## 贡献 Skills

### 添加新 skill

1. 确定 skill 归属：
   - 通用 → 放入 `common/{skill-name}/SKILL.md`
   - 项目专属 → 放入 `projects/{项目名}/{skill-name}/SKILL.md`

2. Skill 目录名**必须全局唯一**（不可与其他 skill 同名）

3. 编写 `SKILL.md`，包含 frontmatter：
   ```yaml
   ---
   name: my-skill
   description: |
     简要描述该 skill 的功能和触发场景。
   ---
   ```

4. 提交并推送：
   ```bash
   git add .
   git commit -m "feat: add {skill-name} skill"
   git push origin master
   ```

5. 通知团队成员在 Cursor 中说"同步skills"即可获取。

### 添加新项目分组

```bash
mkdir -p projects/{新项目名}/{skill-name}
# 编写 SKILL.md
# 提交推送
```

## 现有 Skills 一览

### 公共（common）

| Skill | 说明 |
|-------|------|
| `sync-skills` | 同步团队 Skills 到个人目录，支持全量/按项目/按名称同步 |

### 后端（projects/backend）

| Skill | 说明 |
|-------|------|
| `branch-workflow` | 开发分支管理 SOP（创建分支、提测试PR、提预发布PR） |
| `pr-creator` | PR 自动化流程助手（转测、提单，配合 shell 脚本） |
