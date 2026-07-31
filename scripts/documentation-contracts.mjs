import { access, readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const normalize = (value) => value.replaceAll("\\", "/");

export async function readTreeText(root, relativeDirectory, extensions = new Set([".js", ".jsx", ".md", ".mjs"])) {
  const directory = resolve(root, relativeDirectory);
  const files = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && extensions.has(extname(entry.name))) files.push(path);
    }
  }
  await walk(directory);
  return (await Promise.all(files.sort().map((path) => readFile(path, "utf8")))).join("\n");
}

export async function validateConceptContracts(root, contracts) {
  for (const contract of contracts) {
    const source = await readFile(resolve(root, contract.path), "utf8");
    for (const concept of contract.concepts) {
      const patterns = Array.isArray(concept.patterns) ? concept.patterns : [concept.patterns];
      if (!patterns.some((pattern) => typeof pattern === "string" ? source.includes(pattern) : pattern.test(source))) {
        throw new Error(`${contract.path} missing documentation concept: ${concept.name}`);
      }
    }
  }
}

export async function validateRetiredTerms(root, paths, retiredTerms) {
  for (const path of paths) {
    const source = await readFile(resolve(root, path), "utf8");
    for (const term of retiredTerms) {
      if (typeof term === "string" ? source.includes(term) : term.test(source)) {
        throw new Error(`${path} contains retired terminology: ${term}`);
      }
    }
  }
}

function githubAnchor(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/gu, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-");
}

export async function validateMarkdownLinksAndAnchors(root, paths) {
  const anchorCache = new Map();
  async function anchorsFor(path) {
    if (anchorCache.has(path)) return anchorCache.get(path);
    const markdown = await readFile(path, "utf8");
    const anchors = new Set([...markdown.matchAll(/^#{1,6}\s+(.+)$/gmu)].map((match) => githubAnchor(match[1])));
    anchorCache.set(path, anchors);
    return anchors;
  }

  for (const relativePath of paths) {
    const sourcePath = resolve(root, relativePath);
    const markdown = await readFile(sourcePath, "utf8");
    for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      const raw = match[1];
      if (/^(?:https?:|mailto:)/u.test(raw)) continue;
      const [href, anchor] = raw.split("#", 2);
      const target = resolve(dirname(sourcePath), href || relativePath);
      try { await access(target); } catch { throw new Error(`${relativePath} has a broken relative link: ${raw}`); }
      if (anchor && (await stat(target)).isFile() && !(await anchorsFor(target)).has(githubAnchor(anchor))) {
        throw new Error(`${relativePath} has a broken markdown anchor: ${raw}`);
      }
      if (normalize(relative(root, target)).startsWith("../")) throw new Error(`${relativePath} links outside the documentation root: ${raw}`);
    }
  }
}

export async function validateShellExamples(root, paths) {
  for (const path of paths) {
    const markdown = await readFile(resolve(root, path), "utf8");
    for (const match of markdown.matchAll(/```(?:sh|bash)\n([\s\S]*?)```/gu)) {
      const script = match[1].replace(/^\$\s+/gmu, "");
      const result = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
      if (result.status !== 0) throw new Error(`${path} contains an invalid shell example: ${result.stderr.trim()}`);
    }
  }
}
