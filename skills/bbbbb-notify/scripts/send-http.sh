#!/bin/sh
set -eu

usage() {
  printf '%s\n' 'Usage: send-http.sh [--category activity|attention] [--label text] [--work text] [--message text]' >&2
  exit 2
}

category=activity
label=Update
work=
message=

while [ "$#" -gt 0 ]; do
  case "$1" in
    --category)
      [ "$#" -ge 2 ] || usage
      category=$2
      shift 2
      ;;
    --label)
      [ "$#" -ge 2 ] || usage
      label=$2
      shift 2
      ;;
    --work)
      [ "$#" -ge 2 ] || usage
      work=$2
      shift 2
      ;;
    --message)
      [ "$#" -ge 2 ] || usage
      message=$2
      shift 2
      ;;
    *) usage ;;
  esac
done

case "$category" in
  activity|attention) ;;
  *) usage ;;
esac

source_url=${BBBBB_SOURCE_URL:-}
source_file=${BBBBB_HTTP_SOURCE_FILE:-${XDG_CONFIG_HOME:-"$HOME/.config"}/bbbbb/http-source-url}
store=${BBBBB_HTTP_SOURCE_STORE:-auto}

if [ -z "$source_url" ] && { [ "$store" = auto ] || [ "$store" = keychain ]; } && [ "$(uname -s 2>/dev/null || true)" = Darwin ] && [ -x /usr/bin/security ]; then
  source_url=$(/usr/bin/security find-generic-password -a "${USER:-bbbbb}" -s bbbbb-http-source -w 2>/dev/null || true)
  [ -n "$source_url" ] || [ "$store" = auto ] || {
    printf '%s\n' 'The bbbbb HTTP Source was not found in macOS Keychain.' >&2
    exit 1
  }
fi

if [ -z "$source_url" ] && { [ "$store" = auto ] || [ "$store" = secret-service ]; } && command -v secret-tool >/dev/null 2>&1; then
  source_url=$(secret-tool lookup application bbbbb source http 2>/dev/null || true)
  [ -n "$source_url" ] || [ "$store" = auto ] || {
    printf '%s\n' 'The bbbbb HTTP Source was not found in Secret Service.' >&2
    exit 1
  }
fi

if [ -z "$source_url" ] && { [ "$store" = auto ] || [ "$store" = file ]; }; then
  if [ -L "$source_file" ] || [ ! -f "$source_file" ]; then
    [ "$store" = auto ] || printf '%s\n' 'The bbbbb HTTP Source owner-only file was not found or is not a regular file.' >&2
  else
    mode=$(stat -f %Lp "$source_file" 2>/dev/null || stat -c %a "$source_file" 2>/dev/null || true)
    if [ "$mode" != 600 ]; then
      printf '%s\n' 'The bbbbb HTTP Source file must have mode 0600.' >&2
      exit 1
    fi
    IFS= read -r source_url < "$source_file" || true
  fi
fi

: "${source_url:?BBBBB_SOURCE_URL must be provided by a private environment, supported secret store, or owner-only file}"
case "$source_url" in
  https://*|http://127.0.0.1:*|http://localhost:*) ;;
  *) printf '%s\n' 'BBBBB_SOURCE_URL must use HTTPS or a loopback development URL.' >&2; exit 2 ;;
esac

set -- --data-urlencode "category=$category" --data-urlencode "label=$label"
[ -z "$work" ] || set -- "$@" --data-urlencode "work=$work"
[ -z "$message" ] || set -- "$@" --data-urlencode "message=$message"

curl --fail --silent --show-error \
  --connect-timeout 5 \
  --max-time 20 \
  --output /dev/null \
  --request POST \
  "$@" \
  "$source_url"
printf '%s\n' 'Accepted.'
