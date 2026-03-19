#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# pr-test.sh — 转测流程（机械操作部分）
# 用法: bash pr-test.sh [feature_branch_name]
# 输出: ===PR_DATA=== ... ===PR_DATA_END=== 结构化数据块
###############################################################################

die()  { echo "❌ ERROR: $*" >&2; exit 1; }
info() { echo "➡️  $*"; }

# ── 0. 环境检查 ──────────────────────────────────────────────────────────────
command -v gh &>/dev/null || {
  if [[ "$(uname)" == "Darwin" ]]; then
    info "Installing gh via Homebrew..."
    brew install gh
  elif command -v apt-get &>/dev/null; then
    info "Installing gh via apt..."
    sudo apt-get install -y gh
  else
    die "gh CLI not found. Please install: https://cli.github.com"
  fi
}

gh auth status &>/dev/null 2>&1 \
  || die "gh CLI not authenticated. Set GH_TOKEN in ~/.zshrc then: source ~/.zshrc"

# ── 1. 确认 feature 分支 ────────────────────────────────────────────────────
FB="${1:-$(git branch --show-current)}"
[[ "$FB" =~ ^feature/.+/.+ ]] \
  || die "Branch '$FB' doesn't match 'feature/{user}/**' format."

USER_NAME=$(echo "$FB" | cut -d'/' -f2)
TB=$(echo "$FB" | sed 's|^feature/|tmp_feature/|')

info "Feature branch: $FB"
info "Temp branch:    $TB"

# ── 2. 检查代码已提交并推送 ──────────────────────────────────────────────────
[[ -z "$(git status --porcelain)" ]] \
  || die "Uncommitted changes. Please commit first."
[[ -n "$(git ls-remote --heads origin "$FB")" ]] \
  || die "Branch '$FB' not on remote. Please push first."
[[ -z "$(git log "origin/$FB..$FB" --oneline 2>/dev/null)" ]] \
  || die "Unpushed commits. Please push first."

# ── 3. Fetch ─────────────────────────────────────────────────────────────────
info "Fetching origin..."
git fetch origin

# ── 4. 切换到临时分支并合并 ──────────────────────────────────────────────────
if git show-ref --verify --quiet "refs/heads/$TB"; then
  info "Checkout existing local branch $TB"
  git checkout "$TB"
elif [[ -n "$(git ls-remote --heads origin "$TB")" ]]; then
  info "Checkout remote branch $TB"
  git checkout -b "$TB" "origin/$TB"
else
  info "Creating $TB from test"
  git checkout test
  git pull origin test
  git checkout -b "$TB"
fi

info "Merging $FB into $TB..."
if ! git merge "$FB" --no-edit; then
  echo ""
  die "Merge conflict! Please resolve, then: git add . && git commit — re-run this script afterwards."
fi

# ── 5. 推送 ──────────────────────────────────────────────────────────────────
info "Pushing $TB..."
git push origin "$TB"

# ── 6. 收集 PR 数据 ─────────────────────────────────────────────────────────
OWNER_REPO=$(git remote get-url origin | sed -E 's|.*github\.com[:/]||;s|\.git$||')
OWNER=$(echo "$OWNER_REPO" | cut -d'/' -f1)
REPO=$(echo "$OWNER_REPO"  | cut -d'/' -f2)

TITLE_RAW=$(git log "origin/$FB" -1 --pretty=format:"%s")
STORY_TITLE=$(echo "$TITLE_RAW" | grep -oE '【.*' | sed -E 's|https?://[^ ]+||g' | xargs)
TAPD_INFO=$(git log "origin/$FB" --pretty=format:"%s" -10 | grep -oE '\-\-story=.*' || true)
COMMIT_LOG=$(git log "origin/test..origin/$FB" --oneline || true)
DIFF_STAT=$(git diff "origin/test...origin/$FB" --stat || true)

# ── 7. 切回原分支 ────────────────────────────────────────────────────────────
info "Switching back to $FB"
git checkout "$FB"

# ── 输出结构化数据 ───────────────────────────────────────────────────────────
info "✅ Git operations complete!"
echo ""
cat <<PRDATA
===PR_DATA===
TYPE: test
OWNER: $OWNER
REPO: $REPO
FEATURE_BRANCH: $FB
TARGET_BRANCH: $TB
BASE_BRANCH: test
TITLE_RAW: $TITLE_RAW
STORY_TITLE: $STORY_TITLE
===TAPD_INFO===
$TAPD_INFO
===COMMIT_LOG===
$COMMIT_LOG
===DIFF_STAT===
$DIFF_STAT
===PR_DATA_END===
PRDATA
