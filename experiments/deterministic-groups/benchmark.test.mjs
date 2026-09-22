import test from "node:test";
import assert from "node:assert/strict";
import { benchmark, catalog, measure } from "./benchmark.mjs";

test("all strategies satisfy identical selected definitions and revocation semantics", () => {
  const { rows } = benchmark([100]);
  assert.equal(rows.length, 36);
  for (const row of rows) {
    assert.equal(row.totalBytes, row.requestBytes + row.responseBytes);
    if (row.stage === "warm-unchanged" && row.mode !== "flat")
      assert.equal(row.definitions, 0);
    if (row.stage === "one-definition-changed" && row.mode !== "flat")
      assert.equal(row.definitions, 1);
    if (row.stage === "authorization-revoked-10pct" && row.mode !== "flat")
      assert.equal(row.definitions, 0);
    if (row.stage === "cold")
      assert.equal(
        row.definitions,
        row.mode === "flat" || row.selection === "all" ? 100 : 10,
      );
  }
});
test("full usage reports grouping overhead rather than asserting universal savings", () => {
  const rows = benchmark([100]).rows.filter(
    (r) => r.selection === "all" && r.stage === "cold",
  );
  assert.ok(
    rows.find((r) => r.mode === "grouped").totalBytes >
      rows.find((r) => r.mode === "flat").totalBytes,
  );
});
test("empty authorization cannot leave cached definitions behind", () => {
  const data = catalog(100);
  const names = data.tools.map((t) => t.name);
  for (const mode of ["flat", "manifest", "grouped"]) {
    const cache = new Map();
    measure(data, names, names.slice(0, 10), mode, cache);
    const result = measure(data, [], names.slice(0, 10), mode, cache);
    assert.equal(cache.size, 0);
    assert.equal(result.usableTargets, 0);
  }
});
