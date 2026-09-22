import test from "node:test";
import assert from "node:assert/strict";
import * as reference from "./reference-adapter.mjs";
import { runSuite } from "./suite.mjs";

test("portable contract passes through the bundled async adapter", async () => {
  const report = await runSuite(reference);
  assert.equal(report.results.length, 16);
  assert.ok(
    report.results.every((r) => r.status === "passed"),
    JSON.stringify(report),
  );
  assert.equal(report.pending.length, 6);
});

for (const fault of [
  "digest",
  "authorization",
  "staleness",
  "request-id",
  "serialization",
]) {
  test(`the harness rejects a deliberately broken ${fault} adapter`, async () => {
    const broken = {
      serialize:
        fault === "serialization" ? JSON.stringify : reference.serialize,
      async createAdapter(config) {
        const adapter = await reference.createAdapter(config);
        const request = adapter.request.bind(adapter);
        if (fault === "authorization") adapter.setAllowed = async () => {};
        adapter.request = async (r) => {
          const response = await request(r);
          if (fault === "digest" && r.method === "tools/manifest")
            response.result.entries[0].digest = "sha256:bad";
          if (fault === "request-id") response.id = -1;
          if (
            fault === "staleness" &&
            response.error?.data?.reason === "staleView"
          ) {
            const directory = await request({
              jsonrpc: "2.0",
              id: 9000,
              method: "experimental/groups/list",
            });
            return request({
              ...r,
              params: { ...r.params, revision: directory.result.revision },
            });
          }
          return response;
        };
        return adapter;
      },
    };
    const report = await runSuite(broken);
    assert.ok(report.results.some((r) => r.status === "failed"));
  });
}
