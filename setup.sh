#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# setup.sh — 团队 Cursor Skills 一键初始化
#
# 用法:
#   bash setup.sh                     # 全量安装（公共 + 所有项目）
#   bash setup.sh common              # 仅安装公共 skills
#   bash setup.sh backend             # 安装公共 + backend 项目
#   bash setup.sh backend frontend    # 安装公共 + 多个项目
###############################################################################

REPO_URL="git@github.com:gzxy/zephyr-skills.git"
LOCAL_CACHE="$HOME/.cursor/skills-repo"
SKILLS_DIR="$HOME/.cursor/skills"

info()  { echo "➡️  $*"; }
ok()    { echo "✅ $*"; }
warn()  { echo "⚠️  $*"; }

# ── 1. 克隆或更新共享仓库 ────────────────────────────────────────────────────
if [ -d "$LOCAL_CACHE/.git" ]; then
  info "更新本地缓存..."
  cd "$LOCAL_CACHE" && git pull origin master
else
  info "首次克隆共享仓库..."
  git clone "$REPO_URL" "$LOCAL_CACHE"
fi

mkdir -p "$SKILLS_DIR"

# ── 2. 解析安装范围 ──────────────────────────────────────────────────────────
INSTALL_MODE="all"
PROJECTS=()

if [ $# -gt 0 ]; then
  if [ "$1" = "common" ] && [ $# -eq 1 ]; then
    INSTALL_MODE="common_only"
  else
    INSTALL_MODE="selected"
    PROJECTS=("$@")
  fi
fi

# ── 3. 安装公共 skills ──────────────────────────────────────────────────────
COMMON_DIR="$LOCAL_CACHE/common"
COMMON_COUNT=0
if [ -d "$COMMON_DIR" ]; then
  info "安装公共 skills..."
  for skill_dir in "$COMMON_DIR"/*/; do
    [ -d "$skill_dir" ] || continue
    skill_name=$(basename "$skill_dir")
    cp -r "$skill_dir" "$SKILLS_DIR/"
    echo "   - $skill_name"
    COMMON_COUNT=$((COMMON_COUNT + 1))
  done
fi

# ── 4. 安装项目 skills ──────────────────────────────────────────────────────
PROJECT_COUNT=0
PROJECTS_DIR="$LOCAL_CACHE/projects"

install_project() {
  local project="$1"
  local project_path="$PROJECTS_DIR/$project"
  if [ ! -d "$project_path" ]; then
    warn "项目 '$project' 不存在，跳过（可用项目：$(ls "$PROJECTS_DIR" 2>/dev/null | tr '\n' ' ')）"
    return
  fi
  info "安装 [$project] 的 skills..."
  for skill_dir in "$project_path"/*/; do
    [ -d "$skill_dir" ] || continue
    skill_name=$(basename "$skill_dir")
    cp -r "$skill_dir" "$SKILLS_DIR/"
    echo "   - $skill_name"
    PROJECT_COUNT=$((PROJECT_COUNT + 1))
  done
}

case "$INSTALL_MODE" in
  all)
    if [ -d "$PROJECTS_DIR" ]; then
      for project_dir in "$PROJECTS_DIR"/*/; do
        [ -d "$project_dir" ] || continue
        install_project "$(basename "$project_dir")"
      done
    fi
    ;;
  selected)
    for project in "${PROJECTS[@]}"; do
      install_project "$project"
    done
    ;;
  common_only)
    ;;
esac

# ── 5. 输出报告 ──────────────────────────────────────────────────────────────
TOTAL=$((COMMON_COUNT + PROJECT_COUNT))
echo ""
echo "════════════════════════════════════════"
ok "Skills 安装完成！"
echo "📦 仓库：$REPO_URL"
echo "📁 安装路径：$SKILLS_DIR"
echo "🔢 共安装 $TOTAL 个 skills（公共 $COMMON_COUNT + 项目 $PROJECT_COUNT）"
echo "════════════════════════════════════════"
echo ""
echo "💡 后续更新：在 Cursor 中对 AI 说「同步skills」即可自动拉取最新版本。"
