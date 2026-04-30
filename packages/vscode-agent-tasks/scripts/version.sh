#!/bin/bash
# Automatically calculate and update version based on conventional commits
set -e

cd "$(dirname "$0")/.."

# Get the last vscode-agent-tasks tag
LAST_TAG=$(git tag -l "vscode-agent-tasks-v*" --sort=-version:refname | head -n 1 || echo "")

# Get commits since last tag (or last 10 if no tag)
if [ -n "$LAST_TAG" ]; then
  COMMITS=$(git log "$LAST_TAG"..HEAD --pretty=format:"%s" --no-merges -- .)
  echo "Commits since $LAST_TAG:"
else
  COMMITS=$(git log HEAD~10..HEAD --pretty=format:"%s" --no-merges -- .)
  echo "Commits (last 10, no previous tag found):"
fi
echo "$COMMITS"
echo ""

# Determine bump type from conventional commits
BUMP_TYPE="patch"
if echo "$COMMITS" | grep -qE "^(BREAKING CHANGE:|.*!:)"; then
  BUMP_TYPE="major"
elif echo "$COMMITS" | grep -q "^feat"; then
  BUMP_TYPE="minor"
fi

# Get current version from package.json
CURRENT=$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\([^"]*\)".*/\1/')
echo "Current version: $CURRENT"
echo "Bump type: $BUMP_TYPE"

# Parse version
IFS='.' read -ra V <<< "$CURRENT"

# Calculate new version
case "$BUMP_TYPE" in
  major) V[0]=$((V[0] + 1)); V[1]=0; V[2]=0 ;;
  minor) V[1]=$((V[1] + 1)); V[2]=0 ;;
  patch) V[2]=$((V[2] + 1)) ;;
esac

NEW_VERSION="${V[0]}.${V[1]}.${V[2]}"
echo "New version: $NEW_VERSION"

# Check for --dry-run flag
if [ "$1" = "--dry-run" ]; then
  echo ""
  echo "Dry run - no changes made"
  exit 0
fi

# Update package.json
if [[ "$OSTYPE" == "darwin"* ]]; then
  sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" package.json
else
  sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" package.json
fi

echo ""
echo "Updated package.json to version $NEW_VERSION"

# Auto-commit the version bump
git add package.json
git commit -m "chore: version bump to $NEW_VERSION"
echo "Committed version bump to $NEW_VERSION"
