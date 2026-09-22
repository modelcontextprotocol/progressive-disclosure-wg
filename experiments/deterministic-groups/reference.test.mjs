import test from "node:test";
import assert from "node:assert/strict";
import { Server, Host, fixture, GROUPING, digest } from "./reference.mjs";

function setup(options) {
  const server = new Server(fixture(), options);
  const session = { allowed: new Set(server.data.tools.map((t) => t.name)) };
  const requests = [];
  const host = new Host((r) => {
    requests.push(r);
    return server.request(session, r);
  });
  host.connect();
  return { server, session, host, requests };
}
test("selective discovery, provider schema, original invocation identity", () => {
  const { host, requests } = setup();
  const native = host.activate("query");
  assert.deepEqual(
    native.map((t) => t.function.name),
    ["list_tables", "server_version"],
  );
  assert.deepEqual(
    native[0].function.parameters,
    fixture().tools[0].inputSchema,
  );
  assert.equal(
    requests.some((r) => r.method === "tools/list"),
    false,
  );
  assert.deepEqual(
    requests.find((r) => r.method === "tools/describe").params.names,
    ["list_tables", "server_version"],
  );
  assert.equal(
    host.call("list_tables").content[0].text,
    "Executed list_tables",
  );
  assert.equal(requests.at(-1).params.name, "list_tables");
});
test("multi-group identity and exact switching", () => {
  const { host } = setup();
  host.activate("query");
  const before = host.active.get("server_version");
  host.activate("operations");
  assert.deepEqual(host.active.get("server_version"), before);
  assert.equal(host.active.has("list_tables"), false);
  assert.throws(() => host.activate("operat"), /Invalid params/);
  assert.equal(host.active.size, 0);
});
test("manifest and list have the same authorized set; describe is ordered and atomic", () => {
  const { host, session } = setup();
  session.allowed.delete("cluster_health");
  assert.deepEqual(
    host.rpc("tools/manifest").entries.map((e) => e.name),
    host.rpc("tools/list").tools.map((t) => t.name),
  );
  assert.deepEqual(
    host
      .rpc("tools/describe", { names: ["server_version", "list_tables"] })
      .tools.map((t) => t.name),
    ["server_version", "list_tables"],
  );
  for (const name of ["cluster_health", "missing"]) {
    assert.throws(
      () => host.rpc("tools/describe", { names: ["list_tables", name] }),
      (e) => e.code === -32602 && e.data.unknownNames[0] === name,
    );
  }
  assert.throws(
    () => host.rpc("tools/describe", { names: [] }),
    (e) => e.data.reason === "empty",
  );
  assert.throws(
    () => host.rpc("tools/describe", { names: Array(51).fill("list_tables") }),
    (e) => e.data.maxNames === 50,
  );
});
test("hidden-only groups are absent; guessed groups do not reveal existence", () => {
  const { host, session } = setup();
  session.allowed = new Set(["list_tables"]);
  const directory = host.rpc("experimental/groups/list");
  assert.deepEqual(
    directory.groups.map((g) => g.id),
    ["query"],
  );
  for (const id of ["operations", "missing"])
    assert.throws(
      () =>
        host.rpc("experimental/groups/expand", {
          id,
          revision: directory.revision,
        }),
      (e) => e.data.reason === "unknownGroup",
    );
});
for (const mutation of [
  "membership",
  "schema",
  "authorization",
  "availability",
  "groupDescription",
  "removal",
]) {
  test(`${mutation} invalidates discovery and active registrations can be reconciled`, () => {
    const { host, server, session } = setup();
    host.activate("query");
    const directory = host.rpc("experimental/groups/list");
    if (mutation === "membership")
      server.data.tools[0]._meta[GROUPING].groups = ["operations"];
    if (mutation === "schema")
      server.data.tools[0].inputSchema.description = "Updated schema";
    if (mutation === "authorization") session.allowed.delete("list_tables");
    if (mutation === "availability")
      server.data.tools[0]._meta[GROUPING].callable = false;
    if (mutation === "groupDescription")
      server.data.groups.query = "Updated group";
    if (mutation === "removal") server.data.tools.shift();
    assert.throws(
      () =>
        host.rpc("experimental/groups/expand", {
          id: "query",
          revision: directory.revision,
        }),
      (e) => e.data.reason === "staleView",
    );
    host.invalidate();
    assert.throws(() => host.call("list_tables"), /not active/);
    host.activate("query");
    if (
      ["membership", "authorization", "availability", "removal"].includes(
        mutation,
      )
    )
      assert.equal(host.active.has("list_tables"), false);
  });
}
test("unavailable tools are describable but not activated; calls recheck state", () => {
  const { host, server, session } = setup();
  host.activate("query");
  server.data.tools[0]._meta[GROUPING].callable = false;
  assert.equal(host.call("list_tables").isError, true);
  host.activate("query");
  assert.equal(host.active.has("list_tables"), false);
  assert.equal(
    host.rpc("tools/describe", { names: ["list_tables"] }).tools.length,
    1,
  );
  session.allowed.delete("server_version");
  assert.throws(
    () => host.call("server_version"),
    (e) => e.data.unknownNames[0] === "server_version",
  );
});
for (const phase of ["tools/describe", "final-directory"]) {
  test(`race at ${phase} fails closed and recovers by explicit rediscovery`, () => {
    const { server, session, host } = setup();
    host.activate("query");
    let directories = 0;
    let mutated = false;
    host.send = (r) => {
      if (r.method === "experimental/groups/list") directories++;
      if (
        !mutated &&
        (r.method === phase ||
          (phase === "final-directory" && directories === 2))
      ) {
        server.data.tools[0].description = "Changed";
        mutated = true;
      }
      return server.request(session, r);
    };
    assert.throws(() => host.activate("query"), /mismatch|changed/);
    assert.equal(host.active.size, 0);
    assert.equal(host.activate("query").length, 2);
  });
}
test("tampered response, reordered definitions and size mismatch never activate", () => {
  for (const mode of ["digest", "order", "size"]) {
    const { server, session, host } = setup();
    host.send = (r) => {
      const response = server.request(session, r);
      if (r.method === "tools/describe" && mode === "digest")
        response.result.tools[0].description = "Bad";
      if (r.method === "tools/describe" && mode === "order")
        response.result.tools.reverse();
      if (r.method === "experimental/groups/expand" && mode === "size")
        response.result.entries[0].size++;
      return response;
    };
    assert.throws(() => host.activate("query"), /mismatch/);
    assert.equal(host.active.size, 0);
  }
});
for (const options of [{ grouping: false }, { manifest: false }]) {
  test(`compatibility uses only tools/list: ${JSON.stringify(options)}`, () => {
    const { host, requests } = setup(options);
    assert.equal(host.activate("query").length, 3);
    assert.deepEqual(
      requests.map((r) => r.method),
      ["initialize", "tools/list"],
    );
    assert.equal(host.call("cluster_health").isError, undefined);
  });
}
test("whole-tool digest covers metadata, key order does not matter", () => {
  assert.equal(digest({ a: 1, b: 2 }), digest({ b: 2, a: 1 }));
  const tool = fixture().tools[0];
  const before = digest(tool);
  tool._meta[GROUPING].groups.push("operations");
  assert.notEqual(digest(tool), before);
});
test("bounded batches describe more than 50 selected tools", () => {
  const { server, session, host, requests } = setup();
  server.data.tools = Array.from({ length: 51 }, (_, i) => ({
    ...fixture().tools[0],
    name: `read_${i}`,
  }));
  session.allowed = new Set(server.data.tools.map((t) => t.name));
  assert.equal(host.activate("query").length, 51);
  assert.deepEqual(
    requests
      .filter((r) => r.method === "tools/describe")
      .map((r) => r.params.names.length),
    [50, 1],
  );
});
