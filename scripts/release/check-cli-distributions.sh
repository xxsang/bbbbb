#!/usr/bin/env bash
set -euo pipefail

release_version=$(node -p "require('./release/version.json').components.cli.packageVersion")

root=$(cd "$(dirname "$0")/../.." && pwd)
output="$root/.artifacts/release/cli"
temporary=$(mktemp -d "${TMPDIR:-/tmp}/bbbbb-cli-distributions.XXXXXX")
cleanup() { rm -rf "$temporary"; }
trap cleanup EXIT

cd "$root"
node scripts/release/build-cli-distributions.mjs "$output"
cp "$output/cli-distributions.json" "$temporary/first-manifest.json"
cp "$output/SHA256SUMS" "$temporary/first-sums"
node scripts/release/build-cli-distributions.mjs "$output"
cmp "$temporary/first-manifest.json" "$output/cli-distributions.json"
cmp "$temporary/first-sums" "$output/SHA256SUMS"

(cd "$output" && shasum -a 256 -c SHA256SUMS)
ruby -c "$output/bbbbb.rb" >/dev/null

for target in macos-arm64 macos-x86_64 linux-arm64 linux-x86_64; do
  archive="bbbbb-v${release_version}-${target%-*}-${target#*-}.tar.gz"
  case "$target" in
    macos-x86_64) archive="bbbbb-v${release_version}-macos-x86_64.tar.gz" ;;
    linux-x86_64) archive="bbbbb-v${release_version}-linux-x86_64.tar.gz" ;;
  esac
  mkdir -p "$temporary/$target"
  tar -xzf "$output/$archive" -C "$temporary/$target"
  directory="$temporary/$target/${archive%.tar.gz}"
  test -x "$directory/bbbbb"
  test -L "$directory/completion-inbox"
  test "$(readlink "$directory/completion-inbox")" = "bbbbb"
  for notice in LICENSE README.md THIRD_PARTY_NOTICES.md BUN-LICENSE.md; do test -s "$directory/$notice"; done
done

if [ "$(uname -s)" = Darwin ]; then
  for executable in "$temporary/macos-arm64/bbbbb-v${release_version}-macos-arm64/bbbbb" "$temporary/macos-x86_64/bbbbb-v${release_version}-macos-x86_64/bbbbb"; do
    if codesign -dv --verbose=4 "$executable" 2>&1 | grep -q 'Authority=Developer ID Application'; then
      echo "unsigned macOS payloads must not carry a Developer ID signature; signing happens at release" >&2
      exit 1
    fi
  done
  env -i HOME="$temporary/home-arm64" PATH=/usr/bin:/bin "$temporary/macos-arm64/bbbbb-v${release_version}-macos-arm64/bbbbb" --version | grep -qx "bbbbb ${release_version}"
  arch -x86_64 env -i HOME="$temporary/home-x86_64" PATH=/usr/bin:/bin "$temporary/macos-x86_64/bbbbb-v${release_version}-macos-x86_64/bbbbb" --version | grep -qx "bbbbb ${release_version}"
fi

if [ "$(uname -s)" = Linux ]; then
  case "$(uname -m)" in
    aarch64|arm64)
      env -i HOME="$temporary/home-linux-arm64" PATH=/usr/bin:/bin "$temporary/linux-arm64/bbbbb-v${release_version}-linux-arm64/bbbbb" --version | grep -qx "bbbbb ${release_version}"
      ;;
    x86_64|amd64)
      env -i HOME="$temporary/home-linux-x86_64" PATH=/usr/bin:/bin "$temporary/linux-x86_64/bbbbb-v${release_version}-linux-x86_64/bbbbb" --version | grep -qx "bbbbb ${release_version}"
      ;;
    *) echo "unsupported Linux verification architecture: $(uname -m)" >&2; exit 1 ;;
  esac
fi

if [ "${M8_REQUIRE_DOCKER:-0}" = 1 ]; then
  command -v docker >/dev/null
  docker run --rm --platform linux/arm64 -v "$temporary/linux-arm64/bbbbb-v${release_version}-linux-arm64:/artifact:ro" debian:bookworm-slim /artifact/bbbbb --version | grep -qx "bbbbb ${release_version}"
  docker run --rm --platform linux/amd64 -v "$temporary/linux-x86_64/bbbbb-v${release_version}-linux-x86_64:/artifact:ro" debian:bookworm-slim /artifact/bbbbb --version | grep -qx "bbbbb ${release_version}"
fi

echo "CLI distribution checks passed"
