import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { Server, GROUPING, digest } from "./reference.mjs";

export function catalog(count) {
  const groups = {};
  const tools = Array.from({ length: count }, (_, i) => {
    const group = `domain_${String(Math.floor(i / 10)).padStart(4, "0")}`;
    groups[group] = `Read-only domain ${group}`;
    return {
      name: `read_${String(i).padStart(5, "0")}`,
      description:
        `Read synthetic object ${i}. ` +
        "Return authorized records matching the supplied filter. ".repeat(4),
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(
          Array.from({ length: 8 }, (_, field) => [
            `filter_${field}`,
            {
              type: "string",
              description: `Optional exact filter ${field} for this synthetic object.`,
            },
          ]),
        ),
      },
      annotations: { readOnlyHint: true },
      _meta: { [GROUPING]: { groups: [group], callable: true } },
    };
  });
  return { groups, tools };
}

// A scenario has an immutable authorized view. Memoization only removes repeated
// server computation; requests, responses and byte counts are not changed.
class SnapshotServer extends Server {
  view(session) {
    return (this.snapshot ??= super.view(session));
  }
}
export function measure(data, allowed, wanted, mode, cache = new Map()) {
  const server = new SnapshotServer(data);
  const session = { allowed: new Set(allowed) };
  const totals = {
    requests: 0,
    requestBytes: 0,
    responseBytes: 0,
    definitions: 0,
  };
  const size = (object) => Buffer.byteLength(JSON.stringify(object), "utf8");
  const rpc = (method, params) => {
    const request = {
      jsonrpc: "2.0",
      id: ++totals.requests,
      method,
      ...(params ? { params } : {}),
    };
    const response = server.request(session, request);
    assert.equal(response.error, undefined);
    totals.requestBytes += size(request);
    totals.responseBytes += size(response);
    totals.definitions += response.result.tools?.length ?? 0;
    return response.result;
  };
  const target = wanted.filter((name) => session.allowed.has(name));
  if (mode === "flat") {
    cache.clear();
    for (const tool of rpc("tools/list").tools) cache.set(tool.name, tool);
  } else {
    let entries;
    let directory;
    if (mode === "manifest") entries = rpc("tools/manifest").entries;
    else {
      assert.equal(mode, "grouped");
      directory = rpc("experimental/groups/list");
      // Exact groups are supplied by the scenario, not semantic search.
      const selectedGroups = new Set(
        data.tools
          .filter((t) => wanted.includes(t.name))
          .flatMap((t) => t._meta[GROUPING].groups),
      );
      entries = [];
      for (const group of directory.groups.filter((g) =>
        selectedGroups.has(g.id),
      )) {
        const expanded = rpc("experimental/groups/expand", {
          id: group.id,
          revision: directory.revision,
        });
        assert.equal(expanded.revision, directory.revision);
        entries.push(...expanded.entries);
      }
    }
    const available = new Map(entries.map((e) => [e.name, e]));
    for (const name of cache.keys())
      if (!available.has(name)) cache.delete(name);
    const missing = target.filter(
      (name) =>
        !cache.has(name) ||
        digest(cache.get(name)) !== available.get(name)?.digest,
    );
    for (let offset = 0; offset < missing.length; offset += 50) {
      const batch = missing.slice(offset, offset + 50);
      const tools = rpc("tools/describe", { names: batch }).tools;
      assert.equal(tools.length, batch.length);
      tools.forEach((tool, index) => {
        assert.equal(tool.name, batch[index]);
        assert.equal(digest(tool), available.get(tool.name).digest);
        cache.set(tool.name, tool);
      });
    }
    if (directory)
      assert.equal(
        rpc("experimental/groups/list").revision,
        directory.revision,
      );
  }
  for (const name of target)
    assert.deepEqual(
      cache.get(name),
      data.tools.find((t) => t.name === name),
    );
  for (const name of cache.keys())
    assert.ok(session.allowed.has(name), "revoked definition must be evicted");
  return {
    ...totals,
    totalBytes: totals.requestBytes + totals.responseBytes,
    usableTargets: target.length,
  };
}

export function benchmark(sizes = [100, 1000, 10000]) {
  const rows = [];
  for (const count of sizes) {
    const initial = catalog(count);
    const names = initial.tools.map((t) => t.name);
    for (const selection of ["one-domain", "dispersed", "all"]) {
      const wanted =
        selection === "all"
          ? names
          : selection === "one-domain"
            ? names.slice(0, 10)
            : Array.from(
                { length: 10 },
                (_, i) => names[Math.floor((i * count) / 10)],
              );
      for (const mode of ["flat", "manifest", "grouped"]) {
        const cache = new Map();
        const changed = structuredClone(initial);
        changed.tools[0].description += " Updated definition.";
        const authorized = names.filter((_, i) => i % 10 !== 0);
        for (const [stage, data, allowed] of [
          ["cold", initial, names],
          ["warm-unchanged", initial, names],
          ["one-definition-changed", changed, names],
          ["authorization-revoked-10pct", changed, authorized],
        ])
          rows.push({
            count,
            selection,
            mode,
            stage,
            ...measure(data, allowed, wanted, mode, cache),
          });
      }
    }
  }
  return {
    unit: "UTF-8 compact JSON-RPC bytes, requests plus responses",
    rows,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const report = benchmark();
  if (process.argv[2] === "--check")
    assert.deepEqual(report, JSON.parse(readFileSync(process.argv[3], "utf8")));
  else if (process.argv[2])
    writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify(
      report.rows.filter((row) => row.count === 10000 && row.stage === "cold"),
      null,
      2,
    ),
  );
}
