import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCliDistributions, CLI_TARGETS, createDeterministicTarGz, renderHomebrewFormula, validateCliDistributionManifest } from "./build-cli-distributions.mjs";
import { CLI_PACKAGE_VERSION } from "../release/version-contract.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");

test("deterministic tar generation ignores input ordering", () => {
  const entries = [
    { name: "release/bbbbb", mode: 0o755, content: "binary" },
    { name: "release/LICENSE", mode: 0o644, content: "license" },
  ];
  assert.deepEqual(createDeterministicTarGz(entries), createDeterministicTarGz([...entries].reverse()));
});

test("distribution build is deterministic and covers the exact V1 matrix", async () => {
  const root = process.cwd();
  const temporary = await mkdtemp(join(tmpdir(), "bbbbb-cli-distributions-"));
  const compile = async ({ target, outfile }) => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(outfile, `standalone-${target.id}`);
  };
  const firstDirectory = join(temporary, "first");
  const secondDirectory = join(temporary, "second");
  const first = await buildCliDistributions({ root, outputDirectory: firstDirectory, compile });
  const second = await buildCliDistributions({ root, outputDirectory: secondDirectory, compile });
  assert.deepEqual(first, second);
  assert.deepEqual(first.artifacts.map(({ target }) => target), CLI_TARGETS.map(({ id }) => id));
  for (const artifact of first.artifacts) {
    assert.deepEqual(await readFile(join(firstDirectory, artifact.filename)), await readFile(join(secondDirectory, artifact.filename)));
    const entries = execFileSync("tar", ["-tzf", join(firstDirectory, artifact.filename)], { encoding: "utf8" });
    for (const required of [
      "/bbbbb",
      "/skills/bbbbb-notify/SKILL.md",
      "/skills/bbbbb-notify/agents/openai.yaml",
      "/skills/bbbbb-notify/scripts/send-http.sh",
    ]) assert.match(entries, new RegExp(`${required.replaceAll("/", "\\/")}$`, "mu"));
  }
});

test("Homebrew formula selects every immutable platform archive", () => {
  const artifacts = CLI_TARGETS.map((target) => ({ target: target.id, os: target.os, arch: target.arch, filename: `bbbbb-v${CLI_PACKAGE_VERSION}-${target.os}-${target.arch}.tar.gz`, sha256: digest(target.id), executableSha256: digest(`executable-${target.id}`) }));
  const formula = renderHomebrewFormula(artifacts);
  for (const artifact of artifacts) {
    assert.match(formula, new RegExp(artifact.filename.replaceAll(".", "\\."), "u"));
    assert.match(formula, new RegExp(artifact.sha256, "u"));
  }
  assert.match(formula, /completion-inbox/u);
  assert.doesNotThrow(() => validateCliDistributionManifest({ schemaVersion: 1, product: "bbbbb", releaseVersion: CLI_PACKAGE_VERSION, bunVersion: "1.3.14", artifacts, homebrew: { filename: "bbbbb.rb", sha256: digest(formula) } }));
});
