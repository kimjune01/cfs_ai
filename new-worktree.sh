#!/usr/bin/env bash
# Usage: ./new-worktree.sh <path> [branch]
# Creates a worktree and copies gitignored files from the main tree.
set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <path> [branch]" >&2
    exit 1
fi

TARGET="$1"
BRANCH="${2:-$(basename "$TARGET")}"
MAIN_DIR="$(git rev-parse --show-toplevel)"

git worktree add "$TARGET" -b "$BRANCH"

# Copy every gitignored file that exists in the main tree into the new worktree.
while IFS= read -r -d '' file; do
    rel="${file#"$MAIN_DIR"/}"
    dest="$TARGET/$rel"
    mkdir -p "$(dirname "$dest")"
    cp "$file" "$dest"
done < <(git -C "$MAIN_DIR" ls-files --ignored --exclude-standard --others -z)

echo "Worktree ready at $TARGET (branch: $BRANCH)"
