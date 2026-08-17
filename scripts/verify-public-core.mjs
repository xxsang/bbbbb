import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { validateConceptContracts, validateMarkdownLinksAndAnchors, validateRetiredTerms, validateShellExamples } from "./documentation-contracts.mjs";

const root = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: verify-public-core.mjs <export-directory>");
const required = [
  ".github/workflows/ci.yml", ".gitignore", "README.md", "LICENSE", "CHANGELOG.md", "SECURITY.md", "CONTRIBUTING.md",
  "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_INVENTORY.json", "assets/readme/bbbbb-logo.svg", "assets/readme/bbbbb-demo.svg", "release/version.json", "packages/protocol/LICENSE",
  "packages/protocol/fixtures/protocol-v2-hpke.json", "packages/cli/LICENSE", "services/relay/LICENSE",
  "services/relay/migrations/0004_v2_http_sources.sql", "services/relay/migrations/0005_v2_cli_sources.sql",
  "services/relay/migrations/0006_v2_source_transfers.sql",
  "services/relay/migrations/0007_v13_inbox_usage.sql",
  "services/relay/migrations/0008_v13_entitlements.sql", "services/relay/migrations/0009_v13_app_store_notifications.sql", "services/relay/migrations/0010_v13_remove_daily_quota.sql",
  "skills/bbbbb-notify/SKILL.md", "skills/bbbbb-notify/agents/openai.yaml", "skills/bbbbb-notify/scripts/send-http.sh", "scripts/documentation-contracts.mjs", "scripts/install-bbbbb-notify-skill.sh", "scripts/public-credential-scan.mjs", "docs/guides/API.md",
  "docs/guides/INSTALLING.md", "docs/guides/INTEGRATIONS.md", "docs/guides/MACOS.md", "docs/guides/LINUX.md",
  "docs/guides/WINDOWS.md", "docs/guides/HTTP_SOURCES.md", "docs/guides/CLI_SOURCES.md", "docs/guides/SELF_HOSTING.md", "docs/guides/UPGRADING.md",
  "docs/launch/OPEN_SOURCE.md", "docs/launch/TRUST.md", "docs/launch/OPERATIONS.md", "docs/launch/VERSIONING.md",
];
const files = [];
async function walk(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path); else if (entry.isFile()) files.push(path);
  }
}
await walk(root);
const paths = files.map((path) => relative(root, path).split("\\").join("/"));
for (const path of required) if (!paths.includes(path)) throw new Error(`missing public-core file: ${path}`);
for (const path of ["assets/readme/needs-you.png", "assets/readme/completed-dark.png", "assets/readme/source-approval.png", "assets/readme/event-detail.png", "assets/readme/privacy-lock.png", "assets/readme/sources.png"]) {
  if (paths.includes(path)) throw new Error(`unnecessary README image exported: ${path}`);
}
for (const path of paths) {
  if (/(^|\/)(apps|legacy|\.git|v1|pairing)(\/|$)/u.test(path) || /\.(swift|xcodeproj|xcworkspace)$/u.test(path)) throw new Error(`private or retired path exported: ${path}`);
  if (["scripts/export-public-core.sh", "scripts/export-public-design.mjs"].includes(path)) throw new Error(`private repository export utility included: ${path}`);
  if (["services/relay/src/v11c-proof-worker.ts", "services/relay/wrangler.v11c.jsonc", "services/relay/src/v13-d1-benchmark-worker.ts", "services/relay/wrangler.v13-benchmark.jsonc"].includes(path)) throw new Error(`development proof artifact included: ${path}`);
  if (/(^|\/)[^/]*\.owner\.[^/]*$/u.test(path)) throw new Error(`owner-only file exported: ${path}`);
  if (/(^|\/)(node_modules|dist|\.artifacts|\.build|\.wrangler|coverage)(\/|$)/u.test(path) || /(^|\/)\.dev\.vars$/u.test(path)) throw new Error(`local build output exported: ${path}`);
  if (/migrations\/000[123]_/u.test(path) || /(?:protocol|pairing)-v1/u.test(path)) throw new Error(`protocol-1 compatibility file exported: ${path}`);
}
const readable = files.filter((path) => !path.endsWith("PUBLIC_CORE_MANIFEST.json"));
const text = (await Promise.all(readable.map((path) => readFile(path, "utf8").catch(() => "")))).join("\n");
for (const pattern of [
  new RegExp("-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\\s]+[A-Za-z0-9+/=\\r\\n]{64,}[\\s]+-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", "u"),
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/u, /\bAKIA[0-9A-Z]{16}\b/u, /\/Users\/[A-Za-z0-9._-]+\//u, /com\.xxsang/u,
]) if (pattern.test(text)) throw new Error(`credential or private-path scan matched ${pattern}`);
// Pre-release process framing must not reach the public core.
// Planning identifiers are excluded except where a retired route
// name is asserted to stay rejected.
const publicText = (await Promise.all(
  readable
    .filter((path) => !/(?:verify-public-core\.mjs|test\/index\.test\.ts)$/u.test(path))
    .map((path) => readFile(path, "utf8").catch(() => "")),
)).join("\n");
for (const pattern of [
  /\b[Mm][0-9]{1,2}\b(?![.\-0-9])/u,
  /invited tester|private preview|private beta|private-beta|TestFlight/iu,
  /remains unpublished|does not authorize|publication gate|launch[ -]candidate|private candidate/iu,
  /private monorepo|public-core export|App Review/iu,
]) if (pattern.test(publicText)) throw new Error(`non-public or pre-release framing matched ${pattern}`);
const read = (path) => readFile(join(root, path), "utf8");
const publicMarkdown = ["README.md", ...paths.filter((value) => value.startsWith("docs/guides/") && value.endsWith(".md")), ...paths.filter((value) => value.startsWith("docs/launch/") && value.endsWith(".md"))];
await validateMarkdownLinksAndAnchors(root, publicMarkdown);
await validateShellExamples(root, ["README.md", "docs/guides/HTTP_SOURCES.md", "docs/guides/CLI_SOURCES.md"]);
await validateConceptContracts(root, [
  {
    path: "README.md",
    concepts: [
      { name: "private update promise", patterns: [/Know the moment[\s\S]*work needs you/u] },
      { name: "sender-controlled Attention and Activity", patterns: [/category is chosen by the sender/u, /Attention[\s\S]*Activity/u] },
      { name: "HTTP-first and optional CLI chooser", patterns: [/HTTP Sources are the default/u, /No CLI required/u, /Install the CLI/u] },
      { name: "npm CLI install with release fallback", patterns: [/npm install --global @bbbbbapp\/cli/u, /GitHub Release/u] },
      { name: "honest protection boundary", patterns: [/CLI events leave encrypted/u, /HTTP events are sealed before storage/u] },
      { name: "recoverable privacy boundary", patterns: [/newest 100/u, /seven days/u, /newest 500/u, /30 days/u, /Plus/u, /missed banner/u] },
      { name: "pasteable agent notification prompt", patterns: [/Notify me when it finishes/u, /Attention only if I need to act/u, /No progress updates/u] },
      { name: "routed setup and operations docs", patterns: [/docs\/guides\/INSTALLING\.md/u, /docs\/launch\/OPERATIONS\.md/u] },
    ],
  },
  {
    path: "docs/guides/CLI_SOURCES.md",
    concepts: [
      { name: "CLI install, setup, and readiness", patterns: [/npm install --global @bbbbbapp\/cli/u, /bbbbb setup/u, /bbbbb check/u] },
      { name: "explicit and wrapped sends", patterns: [/bbbbb send --category/u, /bbbbb run --/u] },
      { name: "HTTP-first agent path", patterns: [/HTTP Source/u, /without installing the CLI/u, /No helper or skill is required/u] },
    ],
  },
  {
    path: "docs/guides/HTTP_SOURCES.md",
    concepts: [
      { name: "secret-safe HTTP Source", patterns: [/BBBBB_SOURCE_URL/u, /without printing or sharing/u] },
      { name: "owner-controlled storage", patterns: [/storage choice/u, /config, database, code/u] },
      { name: "requester-first delivery", patterns: [/Connect/u, /temporary QR or six-digit code/u, /2 · First real update received/u] },
      { name: "manual webhook fallback", patterns: [/Webhook or service/u, /Copy private link/u, /Share private link/u] },
      { name: "existing Source access movement", patterns: [/Move sending access/u, /old private link stops working/u] },
    ],
  },
  {
    path: "skills/bbbbb-notify/SKILL.md",
    concepts: [
      { name: "single sender workflow", patterns: [/Who should use this skill/u, /Do not split this/u] },
      { name: "sender-chosen Activity or Attention", patterns: [/Activity or Attention/u, /sender chooses when to notify/u] },
      { name: "secret-safe readiness", patterns: [/bbbbb check/u, /must not silently install software/u] },
      { name: "current setup routes", patterns: [/https:\/\/bbbbb\.app\/connect\//u, /https:\/\/bbbbb\.app\/docs\/cli-source\//u] },
    ],
  },
]);
for (const path of ["README.md", "docs/guides/INSTALLING.md", "docs/guides/CLI_SOURCES.md", "skills/bbbbb-notify/SKILL.md"]) {
  if ((await read(path)).includes("https://bbbbb.app/install.sh")) throw new Error(`${path} contains the retired website installer path`);
}
await validateRetiredTerms(root, ["README.md", "docs/guides/API.md", "docs/guides/CLI_SOURCES.md", "docs/guides/HTTP_SOURCES.md", "docs/guides/INTEGRATIONS.md", "skills/bbbbb-notify/SKILL.md"], ["Needs You", "Completed", "Completion Event", "cp -R skills/bbbbb-notify", /\/v1\//u, /bbbbb (?:pair|invite|join)\b/u]);
for (const path of ["README.md", "docs/guides/INSTALLING.md", "docs/guides/INTEGRATIONS.md", "docs/guides/HTTP_SOURCES.md"]) {
  const value = await read(path);
  for (const forbidden of ["GitHub Actions", "gh secret set", "github-actions"]) {
    if (value.includes(forbidden)) throw new Error(`${path} contains a provider-specific onboarding target: ${forbidden}`);
  }
}
const readme = await read("README.md");
for (const retired of ["needs-you.png", "completed-dark.png", "source-approval.png", "privacy-lock.png", "event-detail.png", "sources.png", "Needs You", "Completed", "V11-", "New in 1.1"]) if (readme.includes(retired)) throw new Error(`public README contains internal or superseded presentation: ${retired}`);
if (readme.split(/\s+/u).length > 500) throw new Error("public README is too long for the concise route-first contract");
for (const path of ["docs/guides/MACOS.md", "docs/guides/LINUX.md", "docs/guides/WINDOWS.md", "docs/guides/HTTP_SOURCES.md", "docs/guides/CLI_SOURCES.md"]) if ((await read(path)).split(/\s+/u).length > 550) throw new Error(`${path} is too long for the concise setup contract`);
for (const retired of ["15-minute threshold", "bbbbb invite", "bbbbb join", "completion-inbox", "one private Channel"]) if (readme.includes(retired)) throw new Error(`public README contains retired guidance: ${retired}`);
for (const requiredPlanCopy of ["1,000 updates", "10,000", "no daily customer quota", "20-submission-per-minute"]) if (!readme.includes(requiredPlanCopy)) throw new Error(`public README is missing the current plan contract: ${requiredPlanCopy}`);

const skillInstallRoot = await mkdtemp(join(tmpdir(), "bbbbb-skill-contract-"));
try {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync("sh", [join(root, "scripts/install-bbbbb-notify-skill.sh")], { env: { ...process.env, AGENTS_SKILLS_DIR: join(skillInstallRoot, "skills") }, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`skill install/update contract failed: ${result.stderr.trim()}`);
  }
  if ((await readFile(join(skillInstallRoot, "skills/bbbbb-notify/SKILL.md"), "utf8")) !== (await read("skills/bbbbb-notify/SKILL.md"))) throw new Error("installed skill does not match the exported skill");
} finally {
  await rm(skillInstallRoot, { recursive: true, force: true });
}
const version = JSON.parse(await read("release/version.json"));
if (version.productVersion !== "1.3.0" || version.components?.protocol?.wireVersion !== 2) throw new Error("public product version contract is not V1.3 protocol 2");
const license = await read("LICENSE");
if (!license.startsWith("                                 Apache License\n                           Version 2.0, January 2004\n")) throw new Error("canonical Apache-2.0 license missing");
for (const path of ["packages/protocol/LICENSE", "packages/cli/LICENSE", "services/relay/LICENSE"]) if ((await read(path)) !== license) throw new Error(`license mismatch: ${path}`);
const packageVersions = new Map([
  ["packages/protocol/package.json", version.components.protocol.packageVersion],
  ["packages/cli/package.json", version.components.cli.packageVersion],
  ["services/relay/package.json", version.components.relay.packageVersion],
]);
for (const [path, packageVersion] of packageVersions) {
  const metadata = JSON.parse(await read(path));
  if (metadata.version !== packageVersion || metadata.private !== false || metadata.license !== "Apache-2.0" || metadata.publishConfig?.access !== "public") throw new Error(`package not publication-ready: ${path}`);
}
for (const path of paths.filter((value) => /(^|\/)wrangler[^/]*\.jsonc$/u.test(value))) {
  const configuration = await read(path);
  if (configuration.includes("account_id")) throw new Error(`Cloudflare account identifier exported: ${path}`);
  for (const match of configuration.matchAll(/"database_id"\s*:\s*"([0-9a-f-]{36})"/giu)) {
    if (match[1] !== "00000000-0000-0000-0000-000000000000") throw new Error(`Cloudflare database identifier exported: ${path}`);
  }
}
const manifest = JSON.parse(await read("PUBLIC_CORE_MANIFEST.json"));
const actual = [];
for (const path of paths.filter((path) => path !== "PUBLIC_CORE_MANIFEST.json").sort((a, b) => a.localeCompare(b))) actual.push({ path, sha256: createHash("sha256").update(await readFile(join(root, path))).digest("hex") });
const treeSha256 = createHash("sha256").update(actual.map((entry) => `${entry.sha256}  ${entry.path}\n`).join("")).digest("hex");
if (JSON.stringify(actual) !== JSON.stringify(manifest.files) || treeSha256 !== manifest.treeSha256) throw new Error("export manifest does not match content");
console.log(`Public core verified: ${actual.length} files, tree ${treeSha256}`);
