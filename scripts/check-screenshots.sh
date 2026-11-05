#!/usr/bin/env bash
# Fails if this branch adds or changes files under docs/screenshots/ compared with its base (default origin/main).
# PRs may commit screenshots while open, but must remove them in their final commit; see docs/agents/mechanic.md,
# "Screenshots". The folders already on main are kept and don't count. Run by .github/workflows/pr-checks.yml.
# Usage: scripts/check-screenshots.sh [base-ref]
set -euo pipefail

base="${1:-origin/main}"
if ! git rev-parse --verify --quiet "${base}^{commit}" >/dev/null; then
  echo "check-screenshots: base ref '${base}' not found (fetch it first, e.g. git fetch origin main)" >&2
  exit 2
fi

changed="$(git diff --name-only --no-renames --diff-filter=AMT "${base}...HEAD" -- docs/screenshots/)"
if [ -n "$changed" ]; then
  {
    echo "This branch adds or changes screenshots compared with ${base}:"
    echo "$changed" | sed 's/^/  /'
    echo "Screenshots must not reach main. Link them in the PR body by commit SHA, then remove the folder in the"
    echo "PR's final commit. See docs/agents/mechanic.md, \"Screenshots\"."
  } >&2
  exit 1
fi
echo "check-screenshots: no screenshots added or changed compared with ${base}"
