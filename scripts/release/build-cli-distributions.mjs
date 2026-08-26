import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { promisify } from "node:util";
import { CLI_PACKAGE_VERSION } from "../release/version-contract.mjs";

const execFileAsync = promisify(execFile);
export const BUN_VERSION = "1.3.14";
export const RELEASE_VERSION = CLI_PACKAGE_VERSION;
export const CLI_TARGETS = Object.freeze([
  { id: "macos-arm64", os: "macos", arch: "arm64", bunTarget: "bun-darwin-arm64" },
  { id: "macos-x86_64", os: "macos", arch: "x86_64", bunTarget: "bun-darwin-x64-baseline" },
  { id: "linux-arm64", os: "linux", arch: "arm64", bunTarget: "bun-linux-arm64" },
  { id: "linux-x86_64", os: "linux", arch: "x86_64", bunTarget: "bun-linux-x64-baseline" },
]);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digestPattern = /^[a-f0-9]{64}$/u;

async function removeBunTemporaryFiles(root) {
  for (const entry of await readdir(root)) if (/^\.[a-f0-9-]+\.bun-build$/u.test(entry)) await rm(join(root, entry), { force: true });
}

function writeString(buffer, offset, length, value) {
  const bytes = Buffer.from(value);
  if (bytes.length > length) throw new Error(`tar field is too long: ${value}`);
  bytes.copy(buffer, offset);
}

function writeOctal(buffer, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, "0");
  if (encoded.length > length - 1) throw new Error(`tar numeric field is too large: ${value}`);
  writeString(buffer, offset, length, `${encoded}\0`);
}

function tarHeader({ name, mode, size, type = "0", linkname = "" }) {
  const header = Buffer.alloc(512);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  writeString(header, 156, 1, type);
  writeString(header, 157, 100, linkname);
  writeString(header, 257, 6, "ustar\0");
  writeString(header, 263, 2, "00");
  writeString(header, 265, 32, "root");
  writeString(header, 297, 32, "root");
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

export function createDeterministicTarGz(entries) {
  const chunks = [];
  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const content = entry.type === "symlink" ? Buffer.alloc(0) : Buffer.from(entry.content);
    chunks.push(tarHeader({
      name: entry.name,
      mode: entry.mode,
      size: content.length,
      type: entry.type === "symlink" ? "2" : "0",
      linkname: entry.linkname ?? "",
    }));
    if (content.length > 0) {
      chunks.push(content);
      const padding = (512 - (content.length % 512)) % 512;
      if (padding > 0) chunks.push(Buffer.alloc(padding));
    }
  }
  chunks.push(Buffer.alloc(1024));
  const compressed = gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 });
  compressed[9] = 255;
  return compressed;
}

export function renderHomebrewFormula(artifacts) {
  const byId = Object.fromEntries(artifacts.map((artifact) => [artifact.target, artifact]));
  const stanza = (id, indent) => {
    const artifact = byId[id];
    if (!artifact) throw new Error(`missing Homebrew artifact: ${id}`);
    const spaces = " ".repeat(indent);
    return `${spaces}url "https://github.com/xxsang/bbbbb/releases/download/v${RELEASE_VERSION}/${artifact.filename}"\n${spaces}sha256 "${artifact.sha256}"`;
  };
  return `class Bbbbb < Formula
  desc "Private completion inbox CLI"
  homepage "https://github.com/xxsang/bbbbb"
  version "${RELEASE_VERSION}"
  license "Apache-2.0"

  on_macos do
    if Hardware::CPU.arm?
${stanza("macos-arm64", 6)}
    else
${stanza("macos-x86_64", 6)}
    end
  end

  on_linux do
    if Hardware::CPU.arm?
${stanza("linux-arm64", 6)}
    else
${stanza("linux-x86_64", 6)}
    end
  end

  def install
    bin.install "bbbbb"
    bin.install_symlink "bbbbb" => "completion-inbox"
  end

  test do
    assert_match "bbbbb ${RELEASE_VERSION}", shell_output("#{bin}/bbbbb --version")
  end
end
`;
}

export function validateCliDistributionManifest(value) {
  if (value?.schemaVersion !== 1 || value.product !== "bbbbb" || value.releaseVersion !== RELEASE_VERSION || value.bunVersion !== BUN_VERSION) throw new Error("CLI distribution identity is invalid");
  if (!Array.isArray(value.artifacts) || value.artifacts.length !== CLI_TARGETS.length) throw new Error("CLI distribution target count is invalid");
  for (const [index, target] of CLI_TARGETS.entries()) {
    const artifact = value.artifacts[index];
    const expectedFilename = `bbbbb-v${RELEASE_VERSION}-${target.os}-${target.arch}.tar.gz`;
    if (artifact?.target !== target.id || artifact.os !== target.os || artifact.arch !== target.arch || artifact.filename !== expectedFilename || !digestPattern.test(artifact.sha256 ?? "") || !digestPattern.test(artifact.executableSha256 ?? "")) throw new Error(`CLI distribution target is invalid: ${target.id}`);
  }
  if (value.homebrew?.filename !== "bbbbb.rb" || !digestPattern.test(value.homebrew.sha256 ?? "")) throw new Error("Homebrew formula identity is invalid");
  return value;
}

async function defaultCompile({ target, entrypoint, outfile }) {
  const { stdout } = await execFileAsync("bun", ["build", entrypoint, "--compile", `--target=${target.bunTarget}`, "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig", "--outfile", basename(outfile)], { cwd: dirname(outfile), maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

export async function buildCliDistributions({ root = process.cwd(), outputDirectory, compile = defaultCompile }) {
  const resolvedRoot = resolve(root);
  const output = resolve(outputDirectory);
  const staging = join(resolvedRoot, ".artifacts", "release", "cli-staging");
  await rm(output, { recursive: true, force: true });
  await rm(staging, { recursive: true, force: true });
  await removeBunTemporaryFiles(resolvedRoot);
  await mkdir(output, { recursive: true });
  const bunVersion = (await execFileAsync("bun", ["--version"])).stdout.trim();
  if (compile === defaultCompile && bunVersion !== BUN_VERSION) throw new Error(`Bun ${BUN_VERSION} is required; found ${bunVersion}`);
  const [license, notices, bunLicense, readme, skill, skillMetadata, httpHelper] = await Promise.all([
    readFile(join(resolvedRoot, "LICENSE")),
    readFile(join(resolvedRoot, "THIRD_PARTY_NOTICES.md")),
    readFile(join(resolvedRoot, "distribution", "cli", "BUN-LICENSE.md")),
    readFile(join(resolvedRoot, "distribution", "cli", "README.md")),
    readFile(join(resolvedRoot, "skills", "bbbbb-notify", "SKILL.md")),
    readFile(join(resolvedRoot, "skills", "bbbbb-notify", "agents", "openai.yaml")),
    readFile(join(resolvedRoot, "skills", "bbbbb-notify", "scripts", "send-http.sh")),
  ]);
  const artifacts = [];
  for (const target of CLI_TARGETS) {
    const targetDirectory = join(staging, target.id);
    const executable = join(targetDirectory, "bbbbb");
    await mkdir(targetDirectory, { recursive: true });
    await compile({ target, entrypoint: join(resolvedRoot, "packages", "cli", "src", "index.ts"), outfile: executable });
    await removeBunTemporaryFiles(resolvedRoot);
    await chmod(executable, 0o755);
    const binary = await readFile(executable);
    const archiveName = `bbbbb-v${RELEASE_VERSION}-${target.os}-${target.arch}.tar.gz`;
    const archiveRoot = archiveName.slice(0, -7);
    const archive = createDeterministicTarGz([
      { name: `${archiveRoot}/BUN-LICENSE.md`, mode: 0o644, content: bunLicense },
      { name: `${archiveRoot}/LICENSE`, mode: 0o644, content: license },
      { name: `${archiveRoot}/README.md`, mode: 0o644, content: readme },
      { name: `${archiveRoot}/THIRD_PARTY_NOTICES.md`, mode: 0o644, content: notices },
      { name: `${archiveRoot}/bbbbb`, mode: 0o755, content: binary },
      { name: `${archiveRoot}/completion-inbox`, mode: 0o777, type: "symlink", linkname: "bbbbb", content: Buffer.alloc(0) },
      { name: `${archiveRoot}/skills/bbbbb-notify/SKILL.md`, mode: 0o644, content: skill },
      { name: `${archiveRoot}/skills/bbbbb-notify/agents/openai.yaml`, mode: 0o644, content: skillMetadata },
      { name: `${archiveRoot}/skills/bbbbb-notify/scripts/send-http.sh`, mode: 0o755, content: httpHelper },
    ]);
    await writeFile(join(output, archiveName), archive);
    artifacts.push({ target: target.id, os: target.os, arch: target.arch, filename: archiveName, sha256: sha256(archive), executableSha256: sha256(binary) });
  }
  const formula = renderHomebrewFormula(artifacts);
  await writeFile(join(output, "bbbbb.rb"), formula);
  const manifest = validateCliDistributionManifest({
    schemaVersion: 1,
    product: "bbbbb",
    releaseVersion: RELEASE_VERSION,
    bunVersion: BUN_VERSION,
    artifacts,
    homebrew: { filename: "bbbbb.rb", sha256: sha256(formula) },
  });
  await writeFile(join(output, "cli-distributions.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(output, "SHA256SUMS"), `${artifacts.map((artifact) => `${artifact.sha256}  ${artifact.filename}`).join("\n")}\n`);
  return manifest;
}

async function main() {
  const [outputDirectory = ".artifacts/release/cli"] = process.argv.slice(2);
  const manifest = await buildCliDistributions({ outputDirectory });
  console.log(`CLI distributions created: ${relative(process.cwd(), resolve(outputDirectory))} (${manifest.artifacts.length} targets)`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
