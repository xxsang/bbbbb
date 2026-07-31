import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: create-export-manifest.mjs <export-directory>");
const files = [];
async function walk(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile() && entry.name !== "PUBLIC_CORE_MANIFEST.json") files.push(path);
  }
}
await walk(root);
const entries = [];
for (const path of files) {
  entries.push({ path: relative(root, path).split("\\").join("/"), sha256: createHash("sha256").update(await readFile(path)).digest("hex") });
}
const treeSha256 = createHash("sha256").update(entries.map((entry) => `${entry.sha256}  ${entry.path}\n`).join("")).digest("hex");
await writeFile(join(root, "PUBLIC_CORE_MANIFEST.json"), `${JSON.stringify({ formatVersion: 1, treeSha256, files: entries }, null, 2)}\n`);
