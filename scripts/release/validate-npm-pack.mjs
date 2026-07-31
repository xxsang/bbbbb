import { readFile } from "node:fs/promises";
import { CLI_PACKAGE_VERSION, PROTOCOL_PACKAGE_VERSION, RELAY_PACKAGE_VERSION } from "../release/version-contract.mjs";

const specifications = [
  { name: "@bbbbbapp/protocol", version: PROTOCOL_PACKAGE_VERSION, required: ["LICENSE", "README.md", "package.json", "dist/src/index.js", "dist/src/index.d.ts"] },
  { name: "@bbbbbapp/cli", version: CLI_PACKAGE_VERSION, required: ["LICENSE", "README.md", "package.json", "dist/src/index.js", "dist/src/index.d.ts"] },
  { name: "@bbbbbapp/relay", version: RELAY_PACKAGE_VERSION, required: ["LICENSE", "README.md", "package.json", "src/index.ts", "migrations/0004_v2_http_sources.sql", "migrations/0005_v2_cli_sources.sql", "migrations/0006_v2_source_transfers.sql", "wrangler.jsonc"] }
];

const paths = process.argv.slice(2);
if (paths.length !== specifications.length) throw new Error("usage: validate-npm-pack.mjs <protocol-pack.json> <cli-pack.json> <relay-pack.json>");
for (const [index, path] of paths.entries()) {
  const [pack] = JSON.parse(await readFile(path, "utf8"));
  const specification = specifications[index];
  if (pack?.name !== specification.name || pack.version !== specification.version) throw new Error(`npm pack identity is invalid: ${specification.name}`);
  const files = (pack.files ?? []).map((file) => file.path).sort();
  for (const required of specification.required) if (!files.includes(required)) throw new Error(`${specification.name} omits ${required}`);
  for (const file of files) if (/(^|\/)(\.dev\.vars|test)(\/|$)/u.test(file)) throw new Error(`${specification.name} contains forbidden path ${file}`);
}
console.log("Prospective npm tarballs contain required runtime files and no local environment/test material");
