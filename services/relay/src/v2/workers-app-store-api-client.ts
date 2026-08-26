import {
  AppStoreServerAPIClient,
  Environment,
  GetTransactionHistoryVersion,
  Order,
  ProductType,
} from "@apple/app-store-server-library";
import type { URLSearchParams } from "node:url";
import type { Response as NodeFetchResponse } from "node-fetch";

const APP_STORE_API_ORIGIN = {
  [Environment.PRODUCTION]: "https://api.storekit.apple.com",
  [Environment.SANDBOX]: "https://api.storekit-sandbox.apple.com",
} as const;

export class WorkersAppStoreServerAPIClient extends AppStoreServerAPIClient {
  private readonly workerAPIOrigin: string;

  constructor(signingKey: string, keyId: string, issuerId: string, bundleId: string, environment: Environment) {
    super(signingKey, keyId, issuerId, bundleId, environment);
    if (environment !== Environment.PRODUCTION && environment !== Environment.SANDBOX) throw new TypeError("unsupported App Store Server API environment");
    this.workerAPIOrigin = APP_STORE_API_ORIGIN[environment];
  }

  protected override makeFetchRequest(
    path: string,
    parsedQueryParameters: URLSearchParams,
    method: string,
    requestBody: string | Buffer | undefined,
    headers: { [key: string]: string },
  ): Promise<NodeFetchResponse> {
    const request: RequestInit = {
      method,
      headers,
      ...(requestBody === undefined ? {} : { body: requestBody as BodyInit }),
    };
    return globalThis.fetch(`${this.workerAPIOrigin}${path}?${parsedQueryParameters}`, request) as unknown as Promise<NodeFetchResponse>;
  }
}

export { Environment, GetTransactionHistoryVersion, Order, ProductType };
