import { readFileSync } from "node:fs";

const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const iosVersionPattern = /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*)){1,2}$/u;
const buildPattern = /^[1-9]\d*$/u;
const exactKeys = (value, keys, field) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error(`${field} structure is invalid`);
};

export function validateVersionContract(value) {
  exactKeys(value, ["schemaVersion", "product", "productVersion", "components", "ios"], "version contract");
  exactKeys(value.components, ["protocol", "cli", "relay"], "version components");
  exactKeys(value.components.protocol, ["packageVersion", "wireVersion"], "protocol version");
  exactKeys(value.components.cli, ["packageVersion"], "CLI version");
  exactKeys(value.components.relay, ["packageVersion"], "relay version");
  exactKeys(value.ios, ["marketingVersion", "buildNumber"], "iOS version");
  if (value.schemaVersion !== 1 || value.product !== "bbbbb") throw new Error("version identity is invalid");
  for (const version of [value.productVersion, value.components.protocol.packageVersion, value.components.cli.packageVersion, value.components.relay.packageVersion]) if (!semverPattern.test(version)) throw new Error("semantic version is invalid");
  if (!Number.isSafeInteger(value.components.protocol.wireVersion) || value.components.protocol.wireVersion < 1) throw new Error("wire protocol version is invalid");
  if (!iosVersionPattern.test(value.ios.marketingVersion) || !buildPattern.test(value.ios.buildNumber)) throw new Error("iOS version is invalid");
  return value;
}

export const VERSION_CONTRACT = Object.freeze(validateVersionContract(JSON.parse(readFileSync(new URL("../../release/version.json", import.meta.url), "utf8"))));
export const PRODUCT_VERSION = VERSION_CONTRACT.productVersion;
export const PROTOCOL_PACKAGE_VERSION = VERSION_CONTRACT.components.protocol.packageVersion;
export const CLI_PACKAGE_VERSION = VERSION_CONTRACT.components.cli.packageVersion;
export const RELAY_PACKAGE_VERSION = VERSION_CONTRACT.components.relay.packageVersion;
export const WIRE_PROTOCOL_VERSION = VERSION_CONTRACT.components.protocol.wireVersion;
export const IOS_MARKETING_VERSION = VERSION_CONTRACT.ios.marketingVersion;
export const IOS_BUILD_NUMBER = VERSION_CONTRACT.ios.buildNumber;
