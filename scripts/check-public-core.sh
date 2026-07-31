#!/usr/bin/env bash
set -euo pipefail

release_version=$(node -p "require('./release/version.json').productVersion")
cli_version=$(node -p "require('./release/version.json').components.cli.packageVersion")

root=$(cd "$(dirname "$0")/.." && pwd)
temporary=$(mktemp -d "${TMPDIR:-/tmp}/bbbbb-public-core.XXXXXX")
server_pid=""
cleanup() {
  if [ -n "$server_pid" ]; then kill "$server_pid" >/dev/null 2>&1 || true; fi
  rm -rf "$temporary"
}
trap cleanup EXIT

if [ -e "$root/LICENSE" ]; then
  cmp "$root/scripts/public-core-LICENSE" "$root/LICENSE"
  if [ "$(git -C "$root" rev-parse --show-toplevel 2>/dev/null || true)" = "$root" ] && git -C "$root" ls-files | grep -Eq '(^|/)(node_modules|dist|\.build|\.wrangler|coverage)(/|$)|(^|/)\.dev\.vars$'; then
    echo "public repository tracks local or build output" >&2
    exit 1
  fi
  mkdir -p "$temporary/current"
  rsync -a --exclude .git --exclude node_modules --exclude dist --exclude .build --exclude .wrangler --exclude coverage --exclude .dev.vars "$root/" "$temporary/current/"
  node "$root/scripts/verify-public-core.mjs" "$temporary/current"
  candidate="$root"
else
  "$root/scripts/export-public-core.sh" "$temporary/first"
  "$root/scripts/export-public-core.sh" "$temporary/second"
  cmp "$root/scripts/public-core-LICENSE" "$temporary/first/LICENSE"
  cmp "$temporary/first/PUBLIC_CORE_MANIFEST.json" "$temporary/second/PUBLIC_CORE_MANIFEST.json"
  node "$root/scripts/verify-public-core.mjs" "$temporary/first"
  node "$root/scripts/verify-public-core.mjs" "$temporary/second"

  git -C "$temporary/first" init --quiet --initial-branch=trunk
  git -C "$temporary/first" add .
  git -C "$temporary/first" -c user.name=release-candidate -c user.email=release-candidate.invalid commit --quiet -m "Initial public-core candidate"
  test "$(git -C "$temporary/first" rev-list --count HEAD)" = "1"
  git -C "$temporary/first" fsck --no-dangling
  candidate="$temporary/first"
fi

cd "$candidate"
npm ci --ignore-scripts
npm audit --audit-level=high
npm run check
node packages/cli/dist/src/index.js --help | grep -q "bbbbb CLI"
node packages/cli/dist/src/index.js --version | grep -qx "bbbbb ${cli_version}"
node scripts/runtime-license-inventory.mjs > "$temporary/runtime-license-inventory.json"
cmp THIRD_PARTY_INVENTORY.json "$temporary/runtime-license-inventory.json"
(cd services/relay && npx wrangler deploy --dry-run --env v11 --outdir "$temporary/wrangler-dry-run")
(cd services/relay && npx wrangler d1 migrations apply M2_EVENTS --local --env v11)
# Use a per-process high port so a stale local Worker cannot satisfy this
# candidate's health probe. Every request is bounded so cleanup always runs.
port=$((18000 + ($$ % 10000)))
(cd services/relay && npx wrangler dev --env v11 --ip 127.0.0.1 --port "$port" > "$temporary/wrangler-dev.log" 2>&1) &
server_pid=$!
health=""
for _ in $(seq 1 40); do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    cat "$temporary/wrangler-dev.log" >&2
    exit 1
  fi
  if health=$(curl --fail --silent --connect-timeout 1 --max-time 2 "http://127.0.0.1:$port/health" 2>/dev/null); then break; fi
  sleep 0.25
done
echo "$health" | grep -q '"service":"bbbbb-relay"'
kill "$server_pid" >/dev/null 2>&1 || true
wait "$server_pid" 2>/dev/null || true
server_pid=""
mkdir -p "$temporary/packs" "$temporary/package-smoke"
npm pack --ignore-scripts --json --pack-destination "$temporary/packs" --workspace @bbbbbapp/protocol > "$temporary/protocol-pack.json"
npm pack --ignore-scripts --json --pack-destination "$temporary/packs" --workspace @bbbbbapp/cli > "$temporary/cli-pack.json"
npm pack --ignore-scripts --json --pack-destination "$temporary/packs" --workspace @bbbbbapp/relay > "$temporary/relay-pack.json"
node scripts/release/validate-npm-pack.mjs "$temporary/protocol-pack.json" "$temporary/cli-pack.json" "$temporary/relay-pack.json"
(cd "$temporary/package-smoke" && npm init --yes >/dev/null && npm install --ignore-scripts --no-package-lock "$temporary/packs/bbbbbapp-protocol-${release_version}.tgz" "$temporary/packs/bbbbbapp-cli-${cli_version}.tgz" "$temporary/packs/bbbbbapp-relay-${release_version}.tgz" >/dev/null)
node_bin=$(dirname "$(command -v node)")
env -i HOME="$temporary/package-home" PATH="$node_bin:/usr/bin:/bin" "$temporary/package-smoke/node_modules/.bin/bbbbb" --version | grep -qx "bbbbb ${cli_version}"
npm audit --omit=dev --audit-level=high

public_core_digest=$(node -e 'console.log(require(process.argv[1]).treeSha256)' "$candidate/PUBLIC_CORE_MANIFEST.json")
echo "Public-core release-candidate checks passed: $public_core_digest"
