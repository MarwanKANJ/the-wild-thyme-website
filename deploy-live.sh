#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

BRANCH="$(git branch --show-current)"
if [[ -z "$BRANCH" ]]; then
  echo "Error: not on a git branch."
  exit 1
fi

if [[ "$BRANCH" != "main" ]]; then
  echo "Warning: current branch is '$BRANCH' (expected 'main')."
  echo "Pushing current branch anyway."
fi

COMMIT_MSG="${1:-Deploy site updates $(date +'%Y-%m-%d %H:%M:%S')}"

if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  git commit -m "$COMMIT_MSG"
else
  echo "No local changes to commit."
fi

echo "Pushing to origin/$BRANCH ..."
git push origin "$BRANCH"

echo "Done: pushed to GitHub."
echo "If Netlify is connected to this repo/branch, deployment is now triggered."
