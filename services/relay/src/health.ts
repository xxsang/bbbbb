import { PROTOCOL_V2 } from "@bbbbbapp/protocol";

const revisionPattern = /^[a-f0-9]{40}$/u;
const digestPattern = /^[a-f0-9]{64}$/u;

export interface HealthEnvironment {
  readonly BUILD_VERSION?: string;
  readonly MIGRATION_SET_SHA256?: string;
  readonly DEPLOYMENT_MANIFEST_SHA256?: string;
}

export function createHealthResponse(environment?: HealthEnvironment): Response {
  const values = [
    environment?.BUILD_VERSION,
    environment?.MIGRATION_SET_SHA256,
    environment?.DEPLOYMENT_MANIFEST_SHA256,
  ];
  const development = values.every((value) => value === undefined);
  const configured =
    revisionPattern.test(environment?.BUILD_VERSION ?? "") &&
    digestPattern.test(environment?.MIGRATION_SET_SHA256 ?? "") &&
    digestPattern.test(environment?.DEPLOYMENT_MANIFEST_SHA256 ?? "");
  const valid = development || configured;
  const unavailable = development ? "development" : "invalid";

  return new Response(
    JSON.stringify({
      service: "bbbbb-relay",
      status: valid ? "ok" : "misconfigured",
      protocolVersion: PROTOCOL_V2,
      deploymentVersion: configured ? environment!.BUILD_VERSION : unavailable,
      migrationSetSha256: configured ? environment!.MIGRATION_SET_SHA256 : unavailable,
      deploymentManifestSha256: configured ? environment!.DEPLOYMENT_MANIFEST_SHA256 : unavailable,
    }),
    {
      status: valid ? 200 : 503,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      },
    },
  );
}
