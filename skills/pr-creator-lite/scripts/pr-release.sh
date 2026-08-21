#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# pr-release.sh — 提单/预发布流程（机械操作部分）
# 用法: bash pr-release.sh [feature_branch_name]
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
info "Feature branch: $FB"

# ── 2. 获取需求 ID ──────────────────────────────────────────────────────────
SID=$(echo "$FB" | rev | cut -d'/' -f1 | rev | grep -oE '^[0-9]+')
[[ -n "$SID" ]] \
  || die "Cannot extract numeric SID from branch '$FB'. Last segment must start with digits, e.g. feature/{user}/{scope}/{SID} or feature/{user}/{scope}/{SID}--suffix"

DATE=$(date +%Y%m%d)
RB="release/${USER_NAME}/${DATE}/${SID}"
TRB="tmp_release/${USER_NAME}/${DATE}/${SID}"
TAPD_INFO="--story=$SID"

# 按 SID 查找远程已有 release 分支（跨日期复用）
EXISTING_RB=$(git ls-remote --heads origin "refs/heads/release/${USER_NAME}/*/${SID}" \
  | awk '{print $2}' | sed 's|refs/heads/||' | head -1)
if [[ -n "$EXISTING_RB" ]]; then
  EXISTING_DATE=$(echo "$EXISTING_RB" | cut -d'/' -f3)
  RB="$EXISTING_RB"
  TRB="tmp_release/${USER_NAME}/${EXISTING_DATE}/${SID}"
  info "Found existing release branch (reusing): $RB"
fi

info "Story ID:        $SID"
info "Release branch:  $RB"
info "TmpRelease:      $TRB"

# ── 3. 检查代码已提交并推送 ──────────────────────────────────────────────────
[[ -z "$(git status --porcelain)" ]] \
  || die "Uncommitted changes. Please commit first."
[[ -n "$(git ls-remote --heads origin "$FB")" ]] \
  || die "Branch '$FB' not on remote. Please push first."
[[ -z "$(git log "origin/$FB..$FB" --oneline 2>/dev/null)" ]] \
  || die "Unpushed commits. Please push first."

# ── 4. Fetch ─────────────────────────────────────────────────────────────────
info "Fetching origin..."
git fetch origin

# ── 5. 创建 release 分支并合并 ──────────────────────────────────────────────
if git show-ref --verify --quiet "refs/heads/$RB"; then
  info "Checkout existing local branch $RB"
  git checkout "$RB"
elif [[ -n "$(git ls-remote --heads origin "$RB")" ]]; then
  info "Checkout remote branch $RB"
  git checkout -b "$RB" "origin/$RB"
else
  info "Creating $RB from master"
  git checkout master
  git pull origin master
  git checkout -b "$RB"
fi

info "Merging $FB into $RB..."
if ! git merge "$FB" --no-edit; then
  die "Merge conflict on $RB! Resolve, then: git add . && git commit — re-run this script."
fi

info "Pushing $RB..."
git push origin "$RB"

# ── 6. 创建 tmp_release 分支并合并 ──────────────────────────────────────────
if git show-ref --verify --quiet "refs/heads/$TRB"; then
  info "Checkout existing local branch $TRB"
  git checkout "$TRB"
  info "Merging latest origin/pre_release into $TRB..."
  if ! git merge origin/pre_release --no-edit; then
    die "Merge conflict while syncing pre_release into $TRB! Resolve, then re-run this script."
  fi
elif [[ -n "$(git ls-remote --heads origin "$TRB")" ]]; then
  info "Checkout remote branch $TRB"
  git checkout -b "$TRB" "origin/$TRB"
  info "Merging latest origin/pre_release into $TRB..."
  if ! git merge origin/pre_release --no-edit; then
    die "Merge conflict while syncing pre_release into $TRB! Resolve, then re-run this script."
  fi
else
  info "Creating $TRB from pre_release"
  git checkout pre_release
  git pull origin pre_release
  git checkout -b "$TRB"
fi

info "Merging $RB into $TRB..."
if ! git merge "$RB" --no-edit; then
  die "Merge conflict on $TRB! Resolve, then: git add . && git commit — re-run this script."
fi

info "Pushing $TRB..."
git push origin "$TRB"

# ── 7. 收集 PR 数据 ─────────────────────────────────────────────────────────
OWNER_REPO=$(git remote get-url origin | sed -E 's|.*github\.com[:/]||;s|\.git$||')
OWNER=$(echo "$OWNER_REPO" | cut -d'/' -f1)
REPO=$(echo "$OWNER_REPO"  | cut -d'/' -f2)

TITLE_RAW=$(git log "origin/$FB" -1 --pretty=format:"%s")
STORY_TITLE=$(echo "$TITLE_RAW" | grep -oE '【.*' | sed -E 's|https?://[^ ]+||g' | xargs)
COMMIT_LOG=$(git log "origin/master..origin/$FB" --oneline || true)
DIFF_STAT=$(git diff "origin/master...origin/$FB" --stat || true)

# ── 8. 切回原分支 ────────────────────────────────────────────────────────────
info "Switching back to $FB"
git checkout "$FB"

# ── 输出结构化数据 ───────────────────────────────────────────────────────────
info "✅ Git operations complete!"
echo ""
cat <<PRDATA
===PR_DATA===
TYPE: release
OWNER: $OWNER
REPO: $REPO
FEATURE_BRANCH: $FB
TARGET_BRANCH: $TRB
RELEASE_BRANCH: $RB
BASE_BRANCH: pre_release
TITLE_RAW: $TITLE_RAW
STORY_TITLE: $STORY_TITLE
STORY_ID: $SID
===TAPD_INFO===
$TAPD_INFO
===COMMIT_LOG===
$COMMIT_LOG
===DIFF_STAT===
$DIFF_STAT
===PR_DATA_END===
PRDATA
