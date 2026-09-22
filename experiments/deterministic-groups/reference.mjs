// Experimental in-process wire model, not an SDK or transport implementation.
import { createHash } from "node:crypto";

export const GROUPING = "experimental/deterministic-groups";
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
export function digest(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}
class Fault extends Error {
  constructor(code, message, data) {
    super(message);
    Object.assign(this, { code, data });
  }
}
function invalid(data) {
  throw new Fault(-32602, "Invalid params", data);
}

export function fixture() {
  const tool = (name, groups) => ({
    name,
    description: `Read ${name}`,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    _meta: { [GROUPING]: { groups, callable: true } },
  });
  return {
    groups: { query: "Inspect tables", operations: "Inspect cluster health" },
    tools: [
      tool("list_tables", ["query"]),
      tool("cluster_health", ["operations"]),
      tool("server_version", ["query", "operations"]),
    ],
  };
}

export class Server {
  constructor(data = fixture(), { grouping = true, manifest = true } = {}) {
    this.data = structuredClone(data);
    this.grouping = grouping && manifest;
    this.manifest = manifest;
  }
  // Session is injected by the trusted transport, never read from request params.
  visible(session) {
    return this.data.tools.filter((t) => session.allowed.has(t.name));
  }
  view(session) {
    const tools = this.visible(session);
    const entries = tools.map((t) => ({
      name: t.name,
      digest: digest(t),
      size: Buffer.byteLength(canonical(t)),
      annotations: t.annotations,
    }));
    const groups = Object.entries(this.data.groups).flatMap(
      ([id, description]) => {
        const members = tools.filter((t) =>
          t._meta[GROUPING].groups.includes(id),
        );
        return members.length
          ? [{ id, description, count: members.length }]
          : [];
      },
    );
    return { tools, entries, groups, revision: digest({ groups, entries }) };
  }
  request(session, request) {
    try {
      const result = this.dispatch(
        session,
        request.method,
        request.params ?? {},
      );
      // JSON boundary prevents tests from depending on shared object references.
      return JSON.parse(
        JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
      );
    } catch (error) {
      if (!(error instanceof Fault)) throw error;
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: error.code, message: error.message, data: error.data },
      };
    }
  }
  dispatch(session, method, params) {
    if (method === "initialize")
      return {
        capabilities: {
          tools: { ...(this.manifest ? { manifest: true } : {}) },
          experimental: this.grouping ? { [GROUPING]: { version: 1 } } : {},
        },
      };
    const view = this.view(session);
    if (method === "tools/list") return { tools: view.tools };
    if (method === "tools/manifest" && this.manifest)
      return { entries: view.entries };
    if (method === "tools/describe" && this.manifest) {
      if (
        !Array.isArray(params.names) ||
        params.names.some((n) => typeof n !== "string")
      )
        invalid({ reason: "names" });
      if (!params.names.length) invalid({ reason: "empty" });
      if (params.names.length > 50) invalid({ maxNames: 50 });
      const unknownNames = params.names.filter(
        (n) => !view.tools.some((t) => t.name === n),
      );
      if (unknownNames.length) invalid({ unknownNames });
      return {
        tools: params.names.map((n) => view.tools.find((t) => t.name === n)),
      };
    }
    if (method === "experimental/groups/list" && this.grouping) {
      return { groups: view.groups, revision: view.revision };
    }
    if (method === "experimental/groups/expand" && this.grouping) {
      if (!view.groups.some((g) => g.id === params.id))
        invalid({ reason: "unknownGroup" });
      if (params.revision !== view.revision) invalid({ reason: "staleView" });
      const names = new Set(
        view.tools
          .filter((t) => t._meta[GROUPING].groups.includes(params.id))
          .map((t) => t.name),
      );
      return {
        entries: view.entries.filter((e) => names.has(e.name)),
        revision: view.revision,
      };
    }
    if (method === "tools/call") {
      const tool = view.tools.find((t) => t.name === params.name);
      if (!tool) invalid({ unknownNames: [params.name] });
      // Fixture tools have empty object schemas; do not pretend to validate arbitrary JSON Schema.
      if (
        !params.arguments ||
        Array.isArray(params.arguments) ||
        typeof params.arguments !== "object" ||
        Object.keys(params.arguments).length
      )
        invalid({ reason: "arguments" });
      if (!tool._meta[GROUPING].callable)
        return {
          isError: true,
          content: [{ type: "text", text: "Unavailable" }],
        };
      return { content: [{ type: "text", text: `Executed ${tool.name}` }] };
    }
    throw new Fault(-32601, "Method not found");
  }
}

export class Host {
  constructor(send) {
    this.send = send;
    this.active = new Map();
    this.sequence = 0;
  }
  rpc(method, params) {
    const response = this.send({
      jsonrpc: "2.0",
      id: ++this.sequence,
      method,
      params,
    });
    if (response.error)
      throw new Fault(
        response.error.code,
        response.error.message,
        response.error.data,
      );
    return response.result;
  }
  connect() {
    this.active.clear();
    this.capabilities = this.rpc("initialize").capabilities;
  }
  activate(groupId) {
    // Fail closed: never keep old provider registrations after failed discovery.
    this.active.clear();
    let tools;
    if (
      this.capabilities.experimental?.[GROUPING]?.version === 1 &&
      this.capabilities.tools?.manifest
    ) {
      const directory = this.rpc("experimental/groups/list");
      const selected = this.rpc("experimental/groups/expand", {
        id: groupId,
        revision: directory.revision,
      });
      tools = [];
      for (let offset = 0; offset < selected.entries.length; offset += 50) {
        const entries = selected.entries.slice(offset, offset + 50);
        const described = this.rpc("tools/describe", {
          names: entries.map((e) => e.name),
        }).tools;
        if (described.length !== entries.length)
          throw new Error("Incomplete describe");
        described.forEach((t, i) => {
          if (
            t.name !== entries[i].name ||
            digest(t) !== entries[i].digest ||
            Buffer.byteLength(canonical(t)) !== entries[i].size
          )
            throw new Error("Definition mismatch; rediscover");
        });
        tools.push(...described);
      }
      if (this.rpc("experimental/groups/list").revision !== directory.revision)
        throw new Error("View changed; rediscover");
    } else {
      tools = this.rpc("tools/list").tools;
    }
    for (const tool of tools)
      if (tool._meta?.[GROUPING]?.callable !== false)
        this.active.set(tool.name, tool);
    return this.providerTools();
  }
  providerTools() {
    // Illustrative provider adapter. Full MCP definitions remain in the host.
    return [...this.active.values()].map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: structuredClone(t.inputSchema),
      },
    }));
  }
  invalidate() {
    this.active.clear();
  }
  call(name, args = {}) {
    if (!this.active.has(name)) throw new Error("Tool is not active");
    return this.rpc("tools/call", { name, arguments: args });
  }
}
