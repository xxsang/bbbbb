#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
source_dir="$repository_root/skills/bbbbb-notify"
skills_root=${AGENTS_SKILLS_DIR:-"$HOME/.agents/skills"}
target_dir="$skills_root/bbbbb-notify"

if [ ! -f "$source_dir/SKILL.md" ]; then
  echo "bbbbb-notify source skill was not found" >&2
  exit 1
fi

mkdir -p "$skills_root" "$target_dir"
cp -R "$source_dir/." "$target_dir/"

if ! cmp -s "$source_dir/SKILL.md" "$target_dir/SKILL.md"; then
  echo "bbbbb-notify skill verification failed" >&2
  exit 1
fi

echo "bbbbb-notify installed or updated at $target_dir"
