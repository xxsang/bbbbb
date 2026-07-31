import { readFile } from "node:fs/promises";

const tree = JSON.parse(await new Promise((resolve, reject) => {
  const child = import("node:child_process").then(({ execFile }) => execFile("npm", ["ls", "--omit=dev", "--all", "--json"], { maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  void child;
}));
const packages = new Map();
function collect(dependencies = {}) {
  for (const [name, value] of Object.entries(dependencies)) {
    if (value.extraneous) continue;
    if (!name.startsWith("@bbbbbapp/")) packages.set(`${name}@${value.version}`, name);
    collect(value.dependencies);
  }
}
collect(tree.dependencies);
const inventory = [];
for (const [id, name] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  const metadata = JSON.parse(await readFile(new URL(`../node_modules/${name}/package.json`, import.meta.url), "utf8"));
  if (typeof metadata.license !== "string" || metadata.license.length === 0) throw new Error(`missing license metadata: ${id}`);
  inventory.push({ package: id, license: metadata.license });
}
const lines = [
  "{",
  '  "generatedFrom": "package-lock.json",',
  '  "runtimeDependencies": [',
  ...inventory.map((entry, index) => `    { "package": ${JSON.stringify(entry.package)}, "license": ${JSON.stringify(entry.license)} }${index + 1 === inventory.length ? "" : ","}`),
  "  ]",
  "}",
];
console.log(lines.join("\n"));
