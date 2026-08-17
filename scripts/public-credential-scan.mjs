import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: public-credential-scan.mjs <directory>");

const excludedDirectories = new Set([".git", ".build", ".wrangler", "coverage", "dist", "node_modules"]);
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile()) files.push(path);
  }
}
await walk(root);

const patterns = [
  { name: "private key", expression: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{64,}[\r\n]+-----END (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/u, binarySafe: true },
  { name: "GitHub token", expression: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/u, binarySafe: true },
  { name: "AWS access key", expression: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u, binarySafe: true },
  { name: "Google API key", expression: /\bAIza[0-9A-Za-z_-]{35}\b/u, binarySafe: true },
  { name: "npm token", expression: /\bnpm_[A-Za-z0-9]{30,}\b/u, binarySafe: true },
  { name: "Slack token", expression: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u, binarySafe: true },
  { name: "Stripe live key", expression: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/u, binarySafe: true },
  { name: "JWT", expression: /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/u, binarySafe: false },
  { name: "literal bearer credential", expression: /\bBearer\s+(?!wrong_|test_|example|\$\{)[A-Za-z0-9._~-]{32,}\b/u, binarySafe: false },
  { name: "credential in URL", expression: /https?:\/\/[^\s/:@]+:[^\s/@]{8,}@[^\s/]+/u, binarySafe: false },
  { name: "bbbbb Source URL", expression: /https:\/\/[^\s"'`]+\/v2\/sources\/[A-Za-z0-9_-]{16,128}\/events\?key=[A-Za-z0-9_-]{32,}/u, binarySafe: true },
  { name: "hard-coded deployment secret", expression: /\b(?:APNS_PRIVATE_KEY|APPLE_SHARED_SECRET|APP_STORE_SHARED_SECRET|BBBBB_SOURCE_URL|CF_API_TOKEN|CLOUDFLARE_API_TOKEN|ENTITLEMENT_ID_KEY|GITHUB_TOKEN)\b\s*[:=]\s*["'][A-Za-z0-9+/_=.-]{20,}["']/u, binarySafe: false },
];

const findings = [];
for (const path of files) {
  const publicPath = relative(root, path).split("\\").join("/");
  if (publicPath === "scripts/public-credential-scan.mjs") continue;
  const data = await readFile(path).catch(() => Buffer.alloc(0));
  const value = data.toString("utf8");
  const binary = data.subarray(0, 8_192).includes(0);
  for (const { name, expression, binarySafe } of patterns) if ((!binary || binarySafe) && expression.test(value)) findings.push(`${name}: ${publicPath}`);
  if (/^wrangler[^/]*\.jsonc$/u.test(basename(path))) {
    if (/"account_id"\s*:/u.test(value)) findings.push(`Cloudflare account identifier: ${publicPath}`);
    for (const match of value.matchAll(/"database_id"\s*:\s*"([0-9a-f-]{36})"/giu)) {
      if (match[1] !== "00000000-0000-0000-0000-000000000000") findings.push(`Cloudflare database identifier: ${publicPath}`);
    }
  }
}

if (findings.length > 0) {
  for (const finding of findings) console.error(finding);
  throw new Error(`public credential scan found ${findings.length} potential exposure(s)`);
}
console.log(`Public credential scan passed: ${files.length} files.`);
