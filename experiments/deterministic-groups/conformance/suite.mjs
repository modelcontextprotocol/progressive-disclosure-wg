import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const readJSON = async (name) =>
  JSON.parse(await readFile(new URL(name, import.meta.url), "utf8"));
export const contract = await readJSON("./contract.json");
const fixture = await readJSON("./fixture.json");
const vectors = await readJSON("./canonical-vectors.json");
const key = "experimental/deterministic-groups";
const names = (objects) => objects.map((o) => o.name).sort();
// Independent oracle for this fixture's ASCII keys and finite JSON values.
function bytes(value) {
  const sorted = (v) =>
    Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sorted(v[k])]),
          )
        : v;
  return Buffer.from(JSON.stringify(sorted(value)), "utf8");
}
function checkEntry(entry, tool) {
  assert.equal(entry.size, bytes(tool).length);
  assert.equal(
    entry.digest,
    `sha256:${createHash("sha256").update(bytes(tool)).digest("hex")}`,
  );
  assert.equal(entry.name, tool.name);
  assert.equal("inputSchema" in entry, false);
  assert.equal("description" in entry, false);
}

const cases = {
  async "authorized-set"({ rpc }) {
    const listed = (await rpc("tools/list")).tools;
    const entries = (await rpc("tools/manifest")).entries;
    assert.deepEqual(names(listed), names(fixture.tools));
    assert.deepEqual(names(entries), names(listed));
    const described = (
      await rpc("tools/describe", { names: entries.map((e) => e.name) })
    ).tools;
    assert.equal(described.length, entries.length);
    entries.forEach((e, i) => {
      checkEntry(e, described[i]);
      assert.deepEqual(
        described[i],
        listed.find((t) => t.name === e.name),
      );
    });
  },
  async "selective-expansion"({ rpc }) {
    const directory = await rpc("experimental/groups/list");
    assert.deepEqual(directory.groups.map((g) => g.id).sort(), [
      "operations",
      "query",
    ]);
    const expanded = await rpc("experimental/groups/expand", {
      id: "query",
      revision: directory.revision,
    });
    assert.equal(expanded.revision, directory.revision);
    assert.deepEqual(names(expanded.entries), [
      "list_tables",
      "server_version",
    ]);
    expanded.entries.forEach((e) =>
      checkEntry(
        e,
        fixture.tools.find((t) => t.name === e.name),
      ),
    );
    const described = await rpc("tools/describe", {
      names: ["server_version", "list_tables"],
    });
    assert.deepEqual(
      described.tools.map((t) => t.name),
      ["server_version", "list_tables"],
    );
  },
  async "shared-identity"({ rpc }) {
    const directory = await rpc("experimental/groups/list");
    const shared = [];
    for (const id of ["query", "operations"]) {
      const expanded = await rpc("experimental/groups/expand", {
        id,
        revision: directory.revision,
      });
      shared.push(expanded.entries.find((e) => e.name === "server_version"));
    }
    assert.ok(shared[0]);
    assert.deepEqual(shared[0], shared[1]);
  },
  async "describe-errors"({ error }) {
    assert.deepEqual((await error("tools/describe", { names: [] })).data, {
      reason: "empty",
    });
    assert.deepEqual(
      (await error("tools/describe", { names: ["list_tables", "missing"] }))
        .data,
      { unknownNames: ["missing"] },
    );
    assert.equal(
      (await error("tools/describe", { names: Array(51).fill("list_tables") }))
        .data.maxNames,
      50,
    );
  },
  async "hidden-groups"({ adapter, rpc, error }) {
    await adapter.setAllowed(["list_tables"]);
    const directory = await rpc("experimental/groups/list");
    assert.deepEqual(
      directory.groups.map((g) => g.id),
      ["query"],
    );
    assert.equal(directory.groups[0].count, 1);
    for (const method of ["tools/list", "tools/manifest"]) {
      const result = await rpc(method);
      assert.deepEqual(names(result.tools ?? result.entries), ["list_tables"]);
    }
    for (const name of ["cluster_health", "missing"]) {
      const failure = await error("tools/describe", { names: [name] });
      assert.deepEqual(failure.data, { unknownNames: [name] });
    }
    const hidden = await error("experimental/groups/expand", {
      id: "operations",
      revision: directory.revision,
    });
    const absent = await error("experimental/groups/expand", {
      id: "missing",
      revision: directory.revision,
    });
    assert.deepEqual(hidden, absent);
  },
  async "unavailable-call"({ adapter, rpc }) {
    const next = structuredClone(fixture);
    next.tools[0]._meta[key].callable = false;
    await adapter.replaceFixture(next);
    assert.equal(
      (await rpc("tools/describe", { names: ["list_tables"] })).tools[0]._meta[
        key
      ].callable,
      false,
    );
    assert.equal(
      (await rpc("tools/call", { name: "list_tables", arguments: {} })).isError,
      true,
    );
  },
  async "revoked-call"({ adapter, rpc, error }) {
    await rpc("tools/describe", { names: ["list_tables"] });
    await adapter.setAllowed(["server_version"]);
    assert.deepEqual(
      (await error("tools/call", { name: "list_tables", arguments: {} })).data,
      { unknownNames: ["list_tables"] },
    );
    assert.equal(
      (await rpc("tools/call", { name: "server_version", arguments: {} }))
        .isError,
      undefined,
    );
  },
  async "reconnect-view"({ create, rpc }) {
    const first = await rpc("experimental/groups/list");
    const second = await create({ allowed: ["list_tables"] });
    const directory = await second.rpc("experimental/groups/list");
    assert.notEqual(first.revision, directory.revision);
    assert.deepEqual(
      directory.groups.map((g) => g.id),
      ["query"],
    );
    assert.deepEqual(
      (
        await second.error("experimental/groups/expand", {
          id: "query",
          revision: first.revision,
        })
      ).data,
      { reason: "staleView" },
    );
  },
  async "legacy-list"({ create }) {
    const legacy = await create({ options: { manifest: false } });
    const initialized = await legacy.rpc("initialize");
    assert.notEqual(initialized.capabilities.tools.manifest, true);
    assert.deepEqual(
      names((await legacy.rpc("tools/list")).tools),
      names(fixture.tools),
    );
    assert.equal(
      (await legacy.rpc("tools/call", { name: "list_tables", arguments: {} }))
        .isError,
      undefined,
    );
  },
};
for (const kind of ["membership", "schema", "authorization"]) {
  cases[`stale-${kind}`] = async ({ adapter, rpc, error }) => {
    const before = await rpc("experimental/groups/list");
    const next = structuredClone(fixture);
    if (kind === "authorization") await adapter.setAllowed(["server_version"]);
    else {
      if (kind === "membership")
        next.tools[0]._meta[key].groups = ["operations"];
      else next.tools[0].inputSchema.description = "Updated";
      await adapter.replaceFixture(next);
    }
    assert.deepEqual(
      (
        await error("experimental/groups/expand", {
          id: "query",
          revision: before.revision,
        })
      ).data,
      { reason: "staleView" },
    );
    const after = await rpc("experimental/groups/list");
    const expanded = await rpc("experimental/groups/expand", {
      id: "query",
      revision: after.revision,
    });
    assert.deepEqual(
      names(expanded.entries),
      kind === "schema"
        ? ["list_tables", "server_version"]
        : ["server_version"],
    );
  };
}

export async function runSuite(implementation) {
  assert.deepEqual(
    Object.keys(cases).sort(),
    [...contract.profiles["server-core"]].sort(),
  );
  const results = [];
  for (const id of contract.profiles["server-core"]) {
    const adapters = [];
    const create = async ({
      allowed = fixture.tools.map((t) => t.name),
      options = {},
    } = {}) => {
      const adapter = await implementation.createAdapter({
        fixture: structuredClone(fixture),
        allowed,
        options,
      });
      adapters.push(adapter);
      let sequence = 0;
      const send = async (method, params) => {
        const request = { jsonrpc: "2.0", id: ++sequence, method, params };
        const response = await adapter.request(request);
        assert.equal(response.jsonrpc, "2.0");
        assert.equal(response.id, request.id);
        assert.notEqual("result" in response, "error" in response);
        return response;
      };
      return {
        adapter,
        create,
        rpc: async (method, params) => {
          const response = await send(method, params);
          assert.equal(response.error, undefined);
          return response.result;
        },
        error: async (method, params) => {
          const response = await send(method, params);
          assert.equal(response.error?.code, -32602);
          return response.error;
        },
      };
    };
    let failure;
    try {
      await cases[id](await create());
    } catch (error) {
      failure = error.message;
    } finally {
      for (const adapter of adapters) {
        try {
          await adapter.close();
        } catch (error) {
          failure ??= `Cleanup failed: ${error.message}`;
        }
      }
    }
    results.push({
      id,
      status: failure ? "failed" : "passed",
      ...(failure ? { detail: failure } : {}),
    });
  }
  assert.deepEqual(
    vectors.map((v) => v.id),
    contract.profiles["canonical-json-ascii"],
  );
  for (const vector of vectors) {
    try {
      assert.equal(
        await implementation.serialize(vector.input),
        vector.canonical,
      );
      results.push({ id: vector.id, status: "passed" });
    } catch (error) {
      results.push({ id: vector.id, status: "failed", detail: error.message });
    }
  }
  return {
    contractVersion: contract.version,
    results,
    pending: contract.pending,
  };
}
