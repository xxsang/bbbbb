import assert from "node:assert/strict";
import test from "node:test";

import { D1V2SourceStore } from "../src/v2/d1-source-store.js";

function databaseWithChanges(changes: number): D1Database {
  const statement = {
    bind() { return this; },
    async run() { return { success: true, meta: { changes } }; },
  };
  return {
    prepare: () => statement,
    batch: async () => [
      { success: true, meta: { changes } },
      { success: true, meta: { changes } },
    ],
  } as unknown as D1Database;
}

test("D1 cascade deletion treats every positive change count as success", async () => {
  const cascading = new D1V2SourceStore(databaseWithChanges(7));
  assert.equal(await cascading.deleteSource("source_000000000000"), true);
  assert.equal(await cascading.deleteInbox("inbox_0000000000000"), true);

  const missing = new D1V2SourceStore(databaseWithChanges(0));
  assert.equal(await missing.deleteSource("source_000000000000"), false);
  assert.equal(await missing.deleteInbox("inbox_0000000000000"), false);
});
