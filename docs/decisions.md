# Decision Log

Tracks decisions for the Progressive Disclosure WG

---

### 2026-10-27: Keep `group` as the primitive name

**Status:** Accepted

**Context:** The naming bikeshed weighed `Groups` against alternatives such as `Bundles` and `Collections`. The WG and the existing prototypes already use `group` throughout.

**Decision:** Keep the primitive named `group`. `Bundles` and `Collections` are rejected.

**Rationale:** No alternative is strongly preferable — `Bundles` and `Collections` carry no decisive advantage, so there is no reason to churn a name that is already established across the WG discussion and the prototype implementations. `group` reads naturally as a unit that gathers related primitives.

**References:**
- [Progressive Disclosure discussion](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/3458)

---

### 2026-10-27: Operations are `groups/get` and `groups/list`, and they are stateless

**Status:** Accepted

**Context:** The operation names were open, with `activate` and `load` proposed alongside `get`. The choice also had to signal whether fetching a group mutates server-side state.

**Decision:** The two operations are `groups/list` (enumerate the groups in the caller's view) and `groups/get` (resolve a group by name). Both are read-only, stateless RPCs: `get`/`list` name a retrieval, not a state transition, and neither records a server-side "active" set. `activate` / `load` are rejected.

**Rationale:** `get`/`list` are the stateless read verbs already used across the protocol. `activate` / `load` would imply a transition the RPC does not perform. Statelessness keeps the operations honest — a client can call `groups/get` freely with no server-side side effects. The `groups/` namespace is plural to match the protocol's existing method namespaces (`tools/list`, `prompts/get`, `resources/read`).

**References:**
- [Progressive Disclosure discussion](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/3458)

---

### 2026-10-27: "When to use" is the `description` field

**Status:** Accepted

**Context:** The field that signals when a client should select a group was proposed under several names, including `summary`, `selectionGuidance`, and `usage`. Every other MCP primitive (tools, prompts, resources) already carries a `description`.

**Decision:** The field that tells a client when to select a group is `description`, matching the base-protocol convention. `summary`, `selectionGuidance`, and `usage` are rejected. Its content must stay focused on when to use the group — the selection signal — not how to use it.

**Rationale:** Reusing `description` keeps groups consistent with every other primitive and avoids introducing a novel field name. Scoping the guidance to when to use preserves the selection signal the SEP relies on.

**References:**
- [Progressive Disclosure discussion](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/3458)

---

### 2026-10-27: Optional `instructions`, with the group's primitives next to it

**Status:** Accepted

**Context:** A group needs to express the "how" of a workflow without conflating it with the "when to use" signal, and clients should not have to make extra round-trips to learn what a group contains.

**Decision:** A group MAY carry optional `instructions` — the "how"/workflow prose — kept distinct from `description`. A group's scoped primitives are delivered next to the group, inline in the same `groups/get` response, rather than fetched separately.

**Rationale:** Placing the primitives alongside the group keeps the shape flat and avoids introducing another nested structure for clients to traverse; the group stays self-contained in a single response. Keeping `instructions` optional lets a group be either a plain bundle of primitives or a richer workflow, without forcing prose where none is needed.

**References:**
- [Progressive Disclosure discussion](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/3458)
