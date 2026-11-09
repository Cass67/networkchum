#!/usr/bin/env bash
# Usage: scripts/release.sh 1.0.3
# Write the CHANGELOG.md section first. Bumps versions, commits, tags that commit, pushes both.
set -euo pipefail
cd "$(dirname "$0")/.."

version="${1:?usage: scripts/release.sh <version>}"
tag="v${version}"

[[ "$(git branch --show-current)" == main ]] || {
  echo "not on main" >&2
  exit 1
}
git rev-parse -q --verify "refs/tags/${tag}" >/dev/null && {
  echo "${tag} already exists" >&2
  exit 1
}
node scripts/release-notes.mjs "$version" >/dev/null

npm version "$version" --workspaces --include-workspace-root --no-git-tag-version >/dev/null
git add -A
git commit -m "chore(release): ${version}"
git tag "$tag"
git push --atomic origin main "$tag"
