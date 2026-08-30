#!/bin/sh
set -eu

version=1.3.0
release_base="https://github.com/xxsang/bbbbb/releases/download/v$version"
store=auto

usage() {
  printf '%s\n' 'Usage: bootstrap.sh [--store auto|file|keychain|secret-service|manual]' >&2
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --store) [ "$#" -ge 2 ] || usage; store=$2; shift 2 ;;
    *) usage ;;
  esac
done
case "$store" in auto|file|keychain|secret-service|manual) ;; *) usage ;; esac

user_home=${BBBBB_USER_HOME:-"$HOME"}
agent_name=
if [ -n "${AGENTS_SKILLS_DIR:-}" ]; then
  skills_root=$AGENTS_SKILLS_DIR
elif [ -n "${CODEX_HOME:-}" ]; then
  skills_root="$CODEX_HOME/skills"
  agent_name=Codex
elif [ -d "$user_home/.codex" ]; then
  skills_root="$user_home/.codex/skills"
  agent_name=Codex
elif [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
  skills_root="$CLAUDE_CONFIG_DIR/skills"
  agent_name=Claude
elif [ -d "$user_home/.claude" ]; then
  skills_root="$user_home/.claude/skills"
  agent_name=Claude
elif [ -d "$user_home/.agents" ]; then
  skills_root="$user_home/.agents/skills"
else
  printf '%s\n' 'No supported shared agent skill directory was found. Ask for the host-specific shared skills path, set AGENTS_SKILLS_DIR to it, and retry.' >&2
  exit 1
fi

os=${BBBBB_INSTALL_OS:-}
arch=${BBBBB_INSTALL_ARCH:-}
platform_label=
if [ -z "$os" ]; then
  case "$(uname -s)" in
    Darwin) os=macos ;;
    Linux) os=linux ;;
    *) printf '%s\n' 'The temporary setup helper supports macOS and glibc Linux. Use the Windows HTTP guide on native Windows.' >&2; exit 1 ;;
  esac
fi
case "$os" in
  macos) platform_label=Mac ;;
  linux) platform_label=Linux ;;
  *) usage ;;
esac
if [ -z "$arch" ]; then
  case "$(uname -m)" in
    arm64|aarch64) arch=arm64 ;;
    x86_64|amd64) arch=x86_64 ;;
    *) printf '%s\n' 'This processor architecture is not supported by the temporary setup helper.' >&2; exit 1 ;;
  esac
fi
case "$arch" in arm64|x86_64) ;; *) usage ;; esac

if [ -n "$agent_name" ]; then
  source_name="$agent_name on $platform_label"
else
  source_name='Coding agent'
fi

archive_name="bbbbb-v$version-$os-$arch.tar.gz"
archive_root=${archive_name%.tar.gz}
temporary_root=$(mktemp -d "${TMPDIR:-/tmp}/bbbbb-setup.XXXXXX")
trap 'rm -rf "$temporary_root"' EXIT HUP INT TERM

if ! curl --fail --silent --show-error --location "$release_base/$archive_name" --output "$temporary_root/$archive_name" ||
   ! curl --fail --silent --show-error --location "$release_base/SHA256SUMS" --output "$temporary_root/SHA256SUMS"; then
  printf '%s\n' 'Allow HTTPS access to github.com, then retry.' >&2
  exit 1
fi

expected=$(awk -v file="$archive_name" '$2 == file { print $1 }' "$temporary_root/SHA256SUMS")
[ -n "$expected" ] || { printf '%s\n' 'The published release checksum does not include this platform archive.' >&2; exit 1; }
if command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$temporary_root/$archive_name" | awk '{ print $1 }')
elif command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$temporary_root/$archive_name" | awk '{ print $1 }')
else
  printf '%s\n' 'A SHA-256 tool is required to verify the temporary setup helper.' >&2
  exit 1
fi
[ "$actual" = "$expected" ] || { printf '%s\n' 'The setup archive checksum did not match. Nothing was executed.' >&2; exit 1; }

tar -xzf "$temporary_root/$archive_name" -C "$temporary_root"
helper="$temporary_root/$archive_root/bbbbb"
skill_source="$temporary_root/$archive_root/skills/bbbbb-notify"
[ -x "$helper" ] || { printf '%s\n' 'The verified archive does not contain the setup helper.' >&2; exit 1; }
[ -f "$skill_source/SKILL.md" ] || { printf '%s\n' 'The verified archive does not contain the notification skill.' >&2; exit 1; }

target_skill="$skills_root/bbbbb-notify"
skill_write_failure() {
  printf '%s\n' 'Allow write access to the shared skills directory, then retry.' >&2
  exit 1
}
mkdir -p "$skills_root" 2>/dev/null || skill_write_failure
[ ! -L "$target_skill" ] || { printf '%s\n' 'The notification skill destination is a symbolic link. Replace it with a regular directory and retry.' >&2; exit 1; }
mkdir -p "$target_skill" 2>/dev/null || skill_write_failure
cp -R "$skill_source/." "$target_skill/" 2>/dev/null || skill_write_failure
chmod 755 "$target_skill/scripts/send-http.sh" 2>/dev/null || skill_write_failure

existing_source=no
source_file=${BBBBB_HTTP_SOURCE_FILE:-${XDG_CONFIG_HOME:-"$user_home/.config"}/bbbbb/http-source-url}
if [ -n "${BBBBB_SOURCE_URL:-}" ]; then
  existing_source=yes
elif [ "$os" = macos ] && [ -x /usr/bin/security ] && /usr/bin/security find-generic-password -a "${USER:-bbbbb}" -s bbbbb-http-source -w >/dev/null 2>&1; then
  existing_source=yes
elif [ "$os" = linux ] && command -v secret-tool >/dev/null 2>&1 && secret-tool lookup application bbbbb source http >/dev/null 2>&1; then
  existing_source=yes
elif [ ! -L "$source_file" ] && [ -f "$source_file" ]; then
  mode=$(stat -f %Lp "$source_file" 2>/dev/null || stat -c %a "$source_file" 2>/dev/null || true)
  [ "$mode" = 600 ] && existing_source=yes
fi

if [ "$existing_source" = yes ]; then
  if "$target_skill/scripts/send-http.sh" --category activity --label Test --work 'Setup test' --message 'bbbbb HTTP alerts are ready on this computer.'; then
    printf '%s\n' 'Existing approved HTTP Source reused. HTTP alerts are ready.'
    exit 0
  fi
  printf '%s\n' 'An existing HTTP Source was found, but its setup test was not accepted. Check outbound HTTPS access or replace that Source in bbbbb, then retry. No new Source was created.' >&2
  exit 1
fi

printf '%s\n' 'Step 2 · Approve its code'
BBBBB_SETUP_HTTP_SUPPRESS_STEP_HEADING=1 "$helper" setup-http --name "$source_name" --store "$store" --qr-size large
printf '%s\n' 'HTTP alerts are ready. The temporary setup executable was deleted; the CLI was not installed.'
