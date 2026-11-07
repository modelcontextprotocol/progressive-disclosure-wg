# SEP-XXXX: Progressive Disclosure via Groups

- **Status**: Draft
- **Type**: Extensions Track
- **Extension Identifier**: `io.modelcontextprotocol/groups`
- **Created**: 2026-09-28
- **Author(s)**: Kurtis Van Gent (@kurtisvg), Haoyu Wang (@helloeve)
- **Sponsor**: TBD
- **PR**: [progressive-disclosure-wg#19](https://github.com/modelcontextprotocol/progressive-disclosure-wg/pull/19)

## Abstract

Agents slow down, spend more, and get less accurate as their tool list grows. A
server with many specialized capabilities is forced to choose between flooding
every session with tools it rarely needs and hiding tools the agent can no
longer discover. MCP has no native way for a server to say a capability is
*situational* — available for a specific workflow, revealed only when the agent
commits to that workflow.

This SEP defines **progressive disclosure of tools and other primitives** as an
optional MCP extension, `io.modelcontextprotocol/groups`. A `Group` is a named,
lightweight bundle a server offers when both sides have negotiated the
extension. Two methods, `groups/list` and `groups/get`, keep listing cheap and
deliver a group's scoped tools, prompts, resources, and nested groups — as
typed, invokable definitions — only when the client fetches the group. Scoped
primitives stay out of `tools/list`, `prompts/list`, and `resources/list`, so a
server can ship rich per-workflow capability without bloating every session.
`groups/get` is a stateless, single round-trip fetch; scoped actions run through
ordinary `tools/call` invocations against server-owned tools, so the client
needs no filesystem and no shell.

**Relationship to the Skills extension.** The accepted Skills extension
([SEP-2640], `io.modelcontextprotocol/skills`) progressively discloses *skills*
— instructions and their supporting files — over a `skill://` resource
convention. It deliberately does not disclose *tools*: a `SKILL.md` can *name*
the tools a workflow orchestrates, but a resource cannot carry a tool's
definition or make it invokable. Groups brings that same progressive discovery
to tools in an MCP-native way — delivering the typed tool (and prompt)
definitions a workflow needs as first-class protocol objects, scoped and on
demand, rather than as names buried in file content. The two compose by
reference: a group can list a skill among its scoped resources, and the skill is
still identified, verified, and loaded through the Skills extension. Groups is
also not skill-specific —
the same mechanism serves plain toolsets and knowledge bundles that are not
skills at all.

**Relationship to SEP-2084.** This is distinct from [SEP-2084]'s primitive
grouping, which modeled group membership as static metadata for client-side
filtering. The distinguishing mechanic here is *on-demand, server-scoped
disclosure* — scoped primitives are kept out of every `*/list` and handed out as
typed definitions only on `groups/get`. See
[Relationship to SEP-2084 (Primitive Grouping)](#relationship-to-sep-2084-primitive-grouping)
for the full comparison.

The extension is opt-in and disabled by default.

[sep-2084]:
    https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2084
[sep-2640]:
    https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640

## Motivation

### Tool and context bloat

Agents slow down, spend more, and get less accurate as their tool list grows.
Accuracy degrades past a handful of active tools; unused tool schemas are billed
on every turn; and per-token latency compounds across multi-step workflows. A
server with many specialized capabilities has no good option today: publishing
them all in `tools/list` bloats every session, while withholding them makes them
undiscoverable. What the ecosystem needs is a way for a server to express that a
capability is *situational* — available for a specific workflow, revealed only
when the agent commits to that workflow.

The instruction side of this problem now has an answer: the Skills extension
discloses a workflow's *instructions* on demand instead of holding them resident
from initialization. Tools have no equivalent. `tools/list` is still all-or-
nothing, so the executable capability a workflow depends on is either always
present or never discoverable.

### The gap the Skills extension leaves: tools

Skills exist largely to orchestrate tools — "fetch the order, then update its
status," "run the form-field script, then assemble the PDF." But a skill
delivered as resources can only *name* the tools it needs; it cannot carry their
definitions or guarantee they are available to the caller. Two consequences show
up in practice:

- **Batteries not included.** A skill is listed and loaded independent of
  whether the tools it orchestrates are reachable. The agent loads a
  "process a refund" workflow, calls the tool it describes, finds the tool
  absent from `tools/list`, and — rather than failing fast — improvises a worse
  path. There is no typed link from a workflow's instructions to the executable
  capability it assumes.
- **Per-caller tool availability.** Tools are frequently gated per user, per
  entitlement, or per location, so two clients connected to the same server see
  different `tools/list` results. A statically published, resource-delivered
  workflow cannot reflect that; it names tools that may or may not exist for the
  caller.

Groups closes this gap. A `groups/get` response delivers a workflow's
instructions **and** the typed definitions of the tools they orchestrate in one
round-trip, computed per session — so a server can scope a group's contents
to the caller's actual entitlements, and the instructions arrive together with
the invokable tools they assume, as one consistent bundle.

### Tools need typed disclosure, not markdown

Resources are files. A file can *reference* a tool by name, but it cannot
express the tool's input schema or make it callable. Disclosing executable
capability therefore needs a typed protocol surface, not a markdown convention:
`groups/get` returns `Tool`, `Prompt`, and `Resource` objects a client already
knows how to render and invoke, with no per-client parser for a file format and
no risk that two servers describe the same relationship in incompatible ways.

This is not a critique of delivering *instructions* as resources — that is
exactly what the Skills extension does, and does well. It is a statement about
the *tools* those instructions drive: they belong in typed protocol responses,
because that is the only form a client can actually invoke.

### Not skill-specific

The value is the *pattern* — progressive disclosure over grouped primitives —
not any one profile. The same mechanism lets a server:

- expose a **toolset** (e.g. all 20 calendar operations) that stays collapsed to
  a single entry until the agent needs calendaring;
- ship a **knowledge bundle** of instructions and reference resources with no
  executable tools at all;
- combine instructions with the tools they orchestrate, optionally listing a
  skill that carries the portable procedure (see
  [Relationship to the Skills extension](#relationship-to-the-skills-extension-iomodelcontextprotocolskills)).

A general `Group` keeps the mechanism uniform and privileges no profile: what
kind of bundle it is follows from what its `groups/get` response carries, not
from a type tag.

## Specification

This section uses RFC-2119 keywords (MUST, SHOULD, MAY) for conformance
requirements. The object shapes below mirror the existing [`tools`][spec-tools],
[`resources`][spec-resources], and [`prompts`][spec-prompts] primitives in the
2026-07-28 specification. All methods, notifications, and capability fields
defined here are part of the `io.modelcontextprotocol/groups` extension and are
in effect only when the extension has been negotiated (see below).

### Extension negotiation

This extension follows the standard [extension negotiation][ext-overview]
mechanism. It is disabled by default and requires explicit opt-in on both sides.

A server that supports the extension advertises it in the `extensions` field of
its capabilities.

```json
{
  "capabilities": {
    "tools": {},
    "extensions": {
      "io.modelcontextprotocol/groups": {}
    }
  }
}
```

A client advertises support in
`_meta["io.modelcontextprotocol/clientCapabilities"].extensions`:

```json
{
  "_meta": {
    "io.modelcontextprotocol/clientCapabilities": {
      "extensions": {
        "io.modelcontextprotocol/groups": {}
      }
    }
  }
}
```

A server MUST NOT expect `groups/*` requests from a client that has not declared
support, and a client MUST NOT issue them against a server that has not
advertised the extension. See [Graceful Degradation](#graceful-degradation) for
required fallback behavior.

### The `Group` object

A `Group` is a lightweight, named object returned by `groups/list`. Its scoped
contents are fetched separately with `groups/get`, so that listing stays cheap and
retrieving a group is the explicit point at which the client pulls its details.

```typescript
/**
 * A named bundle of related primitives the server offers, whose details are
 * fetched on demand to support progressive disclosure. Defined by the
 * `io.modelcontextprotocol/groups` extension.
 *
 * @category `groups/list`
 */
export interface Group {
  /**
   * The unique identifier for the group within the server. Used by the
   * client to reference the group in `groups/get`.
   *
   * MUST be 1–64 characters, lowercase alphanumeric and hyphens, with no
   * leading, trailing, or consecutive hyphens.
   */
  name: string;

  /**
   * Optional human-readable title for display in a host UI.
   */
  title?: string;

  /**
   * A model-facing description of when to select the group. SHOULD be one or
   * two sentences, focused on the selection signal (when to use the group), not
   * on how to use its contents, which belongs in `instructions`. Because the
   * model chooses between groups from this text, it SHOULD carry the task
   * vocabulary a user is likely to use. Clients SHOULD NOT rely on `_meta` for
   * selection.
   */
  description: string;

  /**
   * See [General fields: `_meta`](/specification/2026-07-28/basic/index#meta).
   */
  _meta?: { [key: string]: unknown };
}
```

The constraints on `name` are the same identifier rules the [Agent Skills
naming rules](https://agentskills.io/specification#name-field) apply to a skill's
`name`, so a workflow authored as an Agent Skill can reuse that name as its group
`name`. The two share the skill's *name*, not a full address: the Skills convention
locates a skill by a path (`skill://…/<name>`) whose final segment is that name,
while a group `name` is flat and independent of any navigation hierarchy.

### `groups/list`

Servers respond to `groups/list` with a cursor-paginated array of `Group`
metadata. A `Group` carries only lightweight fields (`name`, `title`,
`description`); a group's scoped tools, prompts, resources, and nested groups
are never part of a list response and are returned only by `groups/get`.

```typescript
/**
 * Sent from the client to request a list of groups the server offers.
 *
 * @category `groups/list`
 */
export interface ListGroupsRequest extends PaginatedRequest {
  method: "groups/list";
}

/**
 * The server's response to a groups/list request.
 *
 * @category `groups/list`
 */
export interface ListGroupsResult extends PaginatedResult, CacheableResult {
  groups: Group[];
}
```

Whether `groups/list` requires a credential is server policy, as it is for the
other `*/list` methods. A server MAY answer it without one, so a client can learn
what the server offers and what it may need to authenticate for. Either way, the
listing reflects the caller's [client view](#placement-and-naming), and leaving a
group out of the list is discovery gating, not access control: a group's contents (`groups/get`) and the invocation of its tools
remain subject to the server's normal authorization (see
[Discovery gating is not access control](#discovery-gating-is-not-access-control)).

### `groups/get`

`groups/get` is the method the client calls to fetch a group the agent intends to
use. It returns everything the client needs to surface the group: its optional
instructions and any scoped primitives it bundles.

`groups/get` is **side-effect-free**: fetching a group SHOULD NOT mutate
server-side session state, and in particular records no server-side notion of
which groups are "active" — activation is client-side state (see
[Statelessness and activation](#statelessness-and-activation)). It is **not**
a promise that the response is invariant: because a group's contents are
computed for the caller's current view, the payload MAY differ between callers
and MAY change over time as the server's offering or the caller's entitlements
change. A client bounds that staleness with the response's caching attributes
rather than any invalidation signal (see
[Caching and change detection](#caching-and-change-detection)).

If no group with the requested `name` exists, the server MUST respond with error
code `-32002` (Resource not found) — the code base `resources/read` uses for an
unknown URI — so that unknown-group handling matches existing precedent rather
than introducing a new convention.

```typescript
/**
 * Parameters for a `groups/get` request.
 *
 * @category `groups/get`
 */
export interface GetGroupRequestParams extends RequestParams {
  /**
   * The name of the group to fetch.
   */
  name: string;
}

/**
 * Used by the client to fetch a group provided by the server.
 *
 * @category `groups/get`
 */
export interface GetGroupRequest extends JSONRPCRequest {
  method: "groups/get";
  params: GetGroupRequestParams;
}

/**
 * The server's response to a `groups/get` request.
 *
 * @category `groups/get`
 */
export interface GetGroupResult extends CacheableResult {
  /**
   * Optional group instructions: a markdown string describing how to use this
   * group's own contents (what to do, how to use the scoped primitives, and any
   * conditional branching). Where `description` says when to select the group,
   * `instructions` say how to use it once selected. A group MAY omit this: a
   * primitives-only group (e.g. a toolset) needs no instructions, while a
   * knowledge bundle may consist of instructions alone. Group instructions are
   * group guidance, not an Agent Skill; a group that needs a portable skill
   * lists it in `resources` (see Relationship to the Skills
   * extension).
   */
  instructions?: string;

  /**
   * Tools scoped to this group, as complete `Tool` definitions with the fields
   * a client needs to invoke them (e.g., `inputSchema`). Scoped tools MUST NOT
   * appear in `tools/list` (see [Placement and naming]).
   */
  tools?: Tool[];

  /**
   * Prompts scoped to this group, as complete `Prompt` definitions. Omitted
   * from `prompts/list`.
   */
  prompts?: Prompt[];

  /**
   * Resources scoped to this group, as complete `Resource` definitions.
   * Omitted from `resources/list`.
   */
  resources?: Resource[];

  /**
   * Child groups the caller can fetch with their own `groups/get` (see
   * Nested groups).
   */
  groups?: Group[];
}
```

The scoped primitives sit directly on the result, next to `instructions`, with no
wrapper object: a group's response is one flat shape the client can read without
traversing another level. This document uses a group's **contents** to mean those
four arrays together. Omitting scoped primitives from `*/list` is a
discovery-gating mechanism only; see
[Discovery gating is not access control](#discovery-gating-is-not-access-control).

A `GetGroupResult` MUST contain at least one of `instructions`, `tools`,
`prompts`, `resources`, or `groups`; an empty response carries no meaning.

### Placement and naming

A **client view** is the set of primitives a server presents to a given client,
determined by that client's identity and the extensions it has negotiated. The
rules below hold within a single view; a server MAY present a different view to a
different client (see [Graceful Degradation](#graceful-degradation)).

**Placement.** Within a view, every tool, prompt, and resource a server offers has
exactly one placement: it is either **top-level**, listed in `tools/list`,
`prompts/list`, or `resources/list`, or **scoped**, carried in the contents of
one or more groups — never both in the same view. Placement is how a server says
whether a primitive is core or situational, and one that is already visible gains
nothing from being disclosed again.

**Naming.** Tool names MUST be unique across a server, and prompt names MUST be
unique across a server — each covering both top-level and scoped entries — because
`tools/call` and `prompts/get` identify their target by name alone, so two
different tools (or two different prompts) sharing a name could not be routed
correctly. Resources are identified by URI, which is already unique, so they need
no additional naming rule. Groups change which primitives are discoverable, not
how calls are routed.

**Sharing.** A scoped tool, prompt, or resource MAY appear in more than one group.
When it does, it is the same primitive, and its definition MUST be identical in
every group that includes it. Guidance that applies to only one workflow belongs
in that group's instructions, not in the primitive's description.

**Instruction references.** Group instructions may name a primitive in one of two
ways, and the distinction resolves where a dependency is placed. A **top-level**
primitive (listed in `tools/list`, `prompts/list`, or `resources/list` for this
view) MAY be named to orchestrate it; being discoverable already, it is not repeated
in the group's contents. A **scoped** primitive a workflow depends on MUST instead
appear in the group's own contents, since that is the only way the caller receives
its definition.

**Availability guarantee.** Every primitive a `groups/get` response returns
is present for that caller and invokable through the ordinary methods
(`tools/call`, `prompts/get`, `resources/read`), subject to the server's normal
authorization. The guarantee covers returned primitives only: a reference in prose,
whether in `instructions` or in a skill the group lists, does not by itself
guarantee availability. Because a server MAY scope contents per caller, a server
that does so SHOULD keep the `instructions` it returns consistent with that same
response's contents, for example by building them from the primitives it actually
returned, and SHOULD NOT reference a scoped primitive it withheld from that caller.
This avoids handing a caller a workflow that names capability it cannot see, the
"batteries not included" failure this extension exists to prevent.

**Identity.** Clients MUST treat a server together with a primitive's name (a
resource's URI) as its identity. A primitive that arrives through several fetched
groups MUST be registered only once. Collisions across different servers are
resolved as they are today.

### Statelessness and activation

"Activation" — the decision that a group is now in play — is a **client-side**
concept, not a server RPC. `groups/get` only fetches; it is the client that then
chooses whether and when to surface the group's instructions and primitives to
the model. This keeps the extension compatible with stateless deployments: a
server holds no per-session "activated groups" set. Because scoped primitives are
omitted from `*/list` only for discovery and remain invokable server-side, no
server session state is required for the mechanism to work.

The client's context is the state. A client tracks which groups it has fetched
and surfaced, and can drop a group's primitives from the model's context (for
example, when compacting a long conversation) without any call to the server.
Re-surfacing the group later is another `groups/get`.

#### Discovery gating is not access control

Scoping a tool controls whether it can be **discovered**, not whether it can be
**invoked**. A scoped tool is a real server-side tool. Whether a `tools/call` for
it succeeds does not depend on whether the client has fetched its group. Servers
MUST NOT rely on scoping or group membership to restrict access. Any tool that
needs protection MUST be protected by the server's normal authorization, exactly
as a top-level tool would be.

### Prompt caching

Fetching a group and then surfacing its primitives changes the set of tools the
model sees, which can interact with provider prompt caches. This is a client-side
concern, and the extension is designed so the client — not the server — controls
the timing:

- `groups/get` is pull-only and idempotent, so the *protocol* surface a server
  advertises does not change underneath a running conversation.
- Clients that add tools at the **end** of the model's context invalidate cache
  only from the insertion point forward, not the whole prefix; surfacing a group's
  tools is therefore a bounded, amortized cost rather than a full cache bust.
  Several providers now support this natively at the model level, so a client on
  such a model can disclose a group's tools mid-conversation while leaving the
  cached prefix (the up-front tool and system blocks) untouched — for example,
  Anthropic's [mid-conversation tool changes][anthropic-midconv] (tools surfaced in
  a mid-conversation system message — by reference to definitions declared up front
  with deferred loading, or, with newer betas, by value) and OpenAI's
  [`additional_tools` input item and tool-search loading][openai-toolsearch] (tools
  loaded at the end of the context window). These are illustrative provider
  mechanisms, not requirements, and their availability varies by model and tier.
- Clients that keep tool definitions in the cached prefix pay more when they add
  tools mid-conversation. Such clients MAY defer surfacing a group's primitives
  to a cache-friendly boundary, batch multiple groups together, or fetch eagerly
  but surface lazily.

The extension does not prescribe any of these strategies; it leaves the
cache/latency trade-off to the client, consistent with not over-prescribing host
behavior.

### Client behavior after `groups/get`

The specification defines the payload returned by `groups/get`. It does **not**
mandate how a client exposes the resulting instructions or scoped primitives to
the model. Hosts differ in their rendering, authorization, and session-state
models; prescribing a single flow would push the spec into territory the [WG
design principles][approaches] explicitly warn against ("Don't be too
prescriptive about client host behavior").

A likely implementation pattern is for the client to expose a small set of
client-side helper tools to the model and route group machinery through them.
For example:

- `get_group`: takes a group name, calls `groups/get`, and returns the
  instructions plus a summary of what the group makes available.
- `read_resource`: lets the model retrieve a scoped resource by URI once the
  group is in play.
- `invoke_prompt`: lets the model trigger a scoped prompt as part of the
  workflow.

This keeps the model's reachable surface small (three client-side tools plus
whatever else the host exposes) while giving the model a clean way to pull in
group content on demand. Scoped tools remain invokable through ordinary
`tools/call` when the client registers them for the session. Other clients may
inject fetched instructions directly into the model's context.

### Caching and change detection

Both `groups/list` and `groups/get` responses extend `CacheableResult`, so each
carries the base protocol's caching attributes: a `ttlMs` freshness hint and a
`cacheScope` marker. Change detection is therefore **pull-based**: a
client treats a fetched listing or group as fresh for `ttlMs` and re-fetches once
it expires. The server tunes staleness per response — a short `ttlMs` for a
volatile group, a long one for a stable toolset, `0` to mean "always re-fetch."

- `cacheScope` will generally be `"private"` for `groups/get`, since a group's
  contents are computed for the caller's view and MUST NOT be shared across
  authorization contexts. A `groups/list` of purely public metadata MAY be
  `"public"`.
- This mirrors the Skills extension, whose `skills/list` carries the same
  attributes and which ships with no change notification of its own; a client
  learns of a change by re-fetching when its cache goes stale.

This matches the model in
[Statelessness and activation](#statelessness-and-activation): `groups/get` is
side-effect-free and its result MAY change between calls, so a TTL hint fits
where an immutability guarantee would not.

This version defines no `notifications/groups/*` and no group subscription
mechanism. Pull-based caching via `ttlMs` is sufficient for the configuration-like
data a group carries (instructions, scoped schemas, nested membership), which
changes on human timescales rather than in real time. Where instant notification is
eventually warranted, it should come from the cross-cutting Triggers & Events work
in progress ([SEP-3415], the Events extension `io.modelcontextprotocol/events`), a
general subscription primitive intended to serve tasks, skills, and groups
uniformly. It should not come from a groups-specific channel or an addition to the
core `subscriptions/listen` filter: adding a field there would edit a core contract
on behalf of an optional extension, which [SEP-3371] (consistent SDK extension
points) counsels against. Staying with caching keeps the extension to two methods
(`groups/list`, `groups/get`), preserves its stateless posture, and avoids
committing to a mechanism the wider effort may supersede. A future version MAY adopt
that primitive additively.

[sep-3415]:
    https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3415
[sep-3371]:
    https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3371

### Nested groups

A group MAY list other groups in `groups`, so a server can disclose its
groups progressively and keep `groups/list` small — see
[Why nesting exists](#why-nesting-exists). Nesting expresses **navigation only**:
a child group is a narrower area the model can drill into, not a dependency of its
parent. If a group's instructions depend on a scoped tool, that tool MUST be in the
group's own `tools` (a top-level tool the instructions merely orchestrate
need not be — see [Placement and naming](#placement-and-naming)); because a scoped
tool may be shared by several groups, composition happens through shared tools and
navigation through nesting.

Within a single client view, a group is either **top-level**, listed in
`groups/list`, or **nested**, listed in the `groups` of one or more
parents — never both. (This is not a routing rule — `groups/get` resolves any
group by its unique name — but, as with tools, keeping a group in one place
avoids registering it twice, keeps `groups/list` small, and avoids sending a
mixed core-vs-situational signal.) A nested group MAY sit under several parents, so
groups and their `groups` references form a **graph**, not a tree: a group
can be reached by more than one path. Its `Group` object MUST be identical wherever
it appears, and a client MUST register such a group only once.
`groups/get` MUST accept the name of any group reachable from `groups/list`, not
only top-level ones. Fetching a parent does **not** expand its children — each
child requires its own `groups/get`.

Cycles are permitted. The extension does not require servers to avoid them, and
a cycle may also come from a buggy or untrusted server, so a client MUST NOT
recurse indefinitely when it encounters one. A
client does not need dedicated cycle-detection logic to satisfy this: it already
tracks which groups it has fetched and registered (each group is registered once
by name — see [Placement and naming](#placement-and-naming)), so traversal
terminates naturally when it reaches a group already in play. The guarantee is
only that traversal halts, not that the graph is acyclic; mandating detection
would duplicate the activation bookkeeping a host keeps regardless.

A parent's `groups` MUST include only child groups visible to the caller.

Servers SHOULD keep hierarchies shallow. Fetching one group is one round-trip,
so a host that eagerly loads the whole graph pays a round-trip per group; a
client MAY issue a level's fetches in parallel so depth, not breadth, bounds the
critical path.

### Graceful Degradation

Because the extension is opt-in, both sides MUST behave sensibly when the other
does not support it:

- Scoping exists only for clients that negotiate this extension. For any other
  client, groups do not exist, and the server decides which tools that session can
  discover through `tools/list` alone. The server MUST make that decision from the
  capabilities declared on **each request**, not from remembered state, so it stays
  stateless. By default a server SHOULD **flatten** — list at top level every tool
  it intends such clients to use; it MAY instead **hide** a tool, in which case the
  tool is *undiscoverable* for that client, not *unavailable* (see
  [Discovery gating is not access control](#discovery-gating-is-not-access-control) —
  leaving a tool out is not an access control). A server MAY therefore return a
  different `tools/list` depending on whether this extension is in effect: a tool
  scoped for an extension client can be top-level for one that is not. Any cache of
  `tools/list`, on the server or an intermediary, MUST be keyed on the declared
  capabilities, so a client never receives a list built for a different capability
  set.
- A client that supports the extension MUST tolerate servers that do not
  advertise it and MUST NOT issue `groups/*` requests to them.
- The extension is not a mandatory-to-connect extension: a server MUST NOT reject
  a connection solely because the client lacks `io.modelcontextprotocol/groups`.

### Naming and collisions

- `name` follows the naming rules above and MUST be unique within a server.
- Cross-server group-name collisions MUST be resolved by the host using a
  deterministic, documented order. Leaving this implementation-defined is an
  impersonation surface: a server can register a well-known group name and rely
  on some host resolving toward it. Tool and prompt names do not collide within a
  server — each MUST be unique across top-level and scoped entries, and resources
  are unique by URI (see [Placement and naming](#placement-and-naming));
  cross-server collisions are resolved as they are today.

[spec-tools]:
    https://modelcontextprotocol.io/specification/2026-07-28/server/tools
[spec-resources]:
    https://modelcontextprotocol.io/specification/2026-07-28/server/resources
[spec-prompts]:
    https://modelcontextprotocol.io/specification/2026-07-28/server/prompts
[approaches]:
    https://github.com/modelcontextprotocol/experimental-ext-skills/blob/main/docs/approaches.md#design-principles
[ext-overview]:
    https://modelcontextprotocol.io/extensions/overview
[anthropic-midconv]:
    https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages
[openai-toolsearch]:
    https://developers.openai.com/api/docs/guides/tools-tool-search#add-tools-at-a-specific-point-in-the-input

## Rationale

### Relationship to the Skills extension (`io.modelcontextprotocol/skills`)

The Skills extension and Groups solve two halves of the same progressive-
disclosure problem and are designed to compose, not compete:

- **Skills disclose instructions and files.** SEP-2640 serves a skill's
  `SKILL.md` and supporting files as `skill://` resources, discovered through an
  index and fetched on demand. That is the right model for *content* — prose,
  references, assets.
- **Groups disclose tools.** A resource cannot carry a tool's schema or make it
  invokable, so a skill can only *name* the tools it orchestrates. Groups
  delivers those tools as typed, invokable definitions, scoped per session and
  fetched in one round-trip alongside the instructions that drive them.

A workflow can use both: a skill describes *what to do*, and a group discloses
*the tools to do it with*, present and matched to the caller. The two compose by
reference. A group lists the skill's `SKILL.md` by its URI in `resources`,
next to the primitives the workflow uses; no new field is needed. Groups does not
redefine what a skill is and does not require the Skills extension. Where both
extensions are in use:

- **A listed skill stays a skill.** It is identified, verified, and activated
  under the Skills extension, exactly as from any other reference. The host
  confirms it with `skills/get` and loads it through its own skill-loading path.
- **Listing is not approval.** A group makes a skill findable alongside its
  tools. It grants no approval and confers no standing on the skill's files.
- **Groups are a valid referrer.** The Skills extension recognizes explicit skill
  references from server `instructions`, another skill, or the user. A group's
  `resources` is one more such reference.
- **Reference by URI, not by scheme.** A skill is not identified by its URI
  scheme; servers may serve skills under schemes other than `skill://`.
- **Group instructions describe the group.** They explain how to use the group's
  own contents. They are not a skill, and carry no skill entry, digests,
  approval, or skill root for relative references. Guidance that should be
  portable belongs in a skill the group lists.

Groups is also useful with no skills at all, as a plain toolset or a knowledge
bundle. How the two extensions should relate long-term is still under WG
discussion; see the
[positioning doc](https://github.com/modelcontextprotocol/progressive-disclosure-wg/pull/22),
which compares competing, complementary, and evolving (rename Groups to Skills)
options. This draft follows the complementary option, which has the most support
so far.

### Relationship to SEP-2084 (Primitive Grouping)

[SEP-2084][sep-2084] also explored grouping MCP primitives, modeling group
membership as static metadata whose primary consumer was client-side filtering
and search. This extension's distinguishing mechanic is instead *on-demand,
server-scoped disclosure*: a group's scoped primitives are kept out of every
`*/list` response and delivered as typed definitions only when the client fetches
the group with `groups/get`. That is genuine, server-authored context reduction —
the server decides what belongs in a group, scopes the primitives, and owns
portability and security — not a UI filter over an already-loaded catalog. In
short, SEP-2084 tagged a flat catalog for client-side filtering; this keeps the
catalog small and hands out the deep definitions progressively from the server.

### Progressive disclosure vs. tool search

Tool search is *a* solution to progressive discovery, not *the* solution.

- **Rejecting a disclosure mechanism because "tool search exists" is itself
  prescriptive.** Most MCP clients today surface tools via a flat list and rely
  on the model to pick. Forcing every client onto tool search as the only path to
  progressive discovery is a dictation; offering this extension alongside the
  existing surface leaves the choice to clients.
- **Search is pull-by-guess; fetching a group is push-the-relevant-set.** Search
  only finds what the agent already thinks to look for. Fetching a group surfaces
  the full set of tools, prompts, and resources the *server* considers relevant to
  the workflow — including capabilities the agent would not have queried for.
- **Search overhead compounds.** If search is the discovery mechanism, every tool
  an agent wants may require a preceding query. A five-tool workflow doubles in
  turn count. Groups pay the disclosure cost once, when the group is fetched.
- **They compose.** Search over 10 groups, each surfacing the handful of tools
  relevant to a workflow, is a better experience than search over 100 tools mixed
  together. If hosts do implement tool search, groups make the result better.

### Communicates availability through placement

Where a server places a tool tells the client what that tool is for. A `Tool` in
`tools/list` is core surface: "reach for it whenever it applies." A `Tool`
surfaced only through a group's `tools` carries the opposite signal:
"situational; reach for it after the agent has committed to the workflow this
tool belongs to." Availability becomes a spectrum the server communicates, not a
binary the client has to infer. The same placement mechanism expresses
agent-vs-user intent for Prompts and Resources: a `Prompt` or `Resource` inside a
group's contents is the server stating *this primitive is fit to be consumed
directly by the agent as part of this workflow*, while top-level entries retain
their human-activated semantics.

### Why tool placement is exclusive

Letting a tool be both top-level and scoped would bring back the ambiguity this
extension is meant to remove. The client would have to reconcile two appearances
of one tool, and the model would get mixed signals about whether the tool is core
or situational. With exclusive placement, every tool is disclosed once, in one
place, with one definition. Groups that orchestrate core tools can still name them
in their instructions.

Early prototype results point the same way: while a catalog call still listed
every tool name, models never took the group path; once it listed only top-level
tools and pointed at `groups/get`, they did (see
[Early prototype evidence](#early-prototype-evidence)). A scoped tool that also
shows up somewhere the model reads first undoes the disclosure.

### Why nesting exists

Progressive disclosure of tools shrinks `tools/list`, but a server with many
groups just moves the bloat up a level into `groups/list`. Nesting applies the
same idea recursively: the server discloses its groups progressively, so the
top-level list stays small and the model drills down only into the areas it needs
(`github` → `issues`, `pull-requests`, `actions`). Nesting is navigation, not
composition — a workflow that needs another group's tools gets them through the
shared-tool rule, not by reaching into a child group, so the tools a group's
instructions depend on still arrive in the same `groups/get`.

### Simpler for clients to implement

This extension is two methods, `groups/list` and `groups/get`, largely composed
of existing primitives. The `groups/get` response delivers typed `Tool`,
`Prompt`, `Resource`, and nested `Group` objects the client already knows how to
render and invoke. Adding group support is roughly the work of adding any other
extension.

### Early prototype evidence

Community members tested the design against working servers while the draft was
in review. These are early, single-implementation data points, not a benchmark,
but they support the main design choices:

- **Context savings come from stopping early.** On a local prototype with 19
  tools in 5 groups, top-level tools plus `groups/list` plus one `groups/get`
  came to 2,388 tokens, against 10,398 for the flat `tools/list` (about 23%).
  The groups envelope added 58 tokens. Fetching every group cost about 5% more
  than the flat list, so the saving comes from the client fetching only the
  group the task needs ([comment][markus-measure]).
- **Models take the group path when the description carries the task.** With
  local 8B and 14B models (14 tasks, 5 seeds), the 14B model routed through
  `groups/get` on 65 of 70 trials and the 8B model on 47 of 70, once nothing
  read before `groups/get` named the scoped tools. A scope expressed only in
  `_meta` was ignored. This is why `description` SHOULD carry the task
  vocabulary and clients SHOULD NOT rely on `_meta` for selection.
- **Groups save context; they don't beat a list the model can read.** With every
  schema visible, the same models already selected correctly (70 of 70 and 68 of
  70). The benefit is keeping unread schemas out of context, not better
  selection over a small catalog.
- **Callable but unlisted works, and gating isn't authorization.** A production
  server already kept old tool names callable but unlisted without breakage
  ([comment][markus-datapoint]). Running the PR #20 client against read, write,
  and admin accounts, hiding the admin group did not bypass authorization: its
  tool call was still denied for read and write callers and allowed for admin
  ([comment][markus-authz]).

No frontier models were tested, and token counts were taken on raw JSON rather
than a provider's tool prompt. Broader evaluation should follow the criteria in
the WG problem statement: initial context size, total tokens, latency, and task
completion across catalog sizes.

[markus-measure]:
    https://github.com/modelcontextprotocol/progressive-disclosure-wg/pull/19#issuecomment-6266574505
[markus-datapoint]:
    https://github.com/modelcontextprotocol/progressive-disclosure-wg/pull/19#issuecomment-6169681371
[markus-authz]:
    https://github.com/modelcontextprotocol/progressive-disclosure-wg/pull/19#issuecomment-6635617501

### Naming

The WG settled the naming questions raised in review:

- **Primitive: `group`.** `Bundles` and `Collections` were considered and
  rejected; neither had a decisive advantage over a name already established
  across the WG discussion and prototypes.
- **Methods: `groups/list` and `groups/get`.** These are the stateless read verbs
  used across the protocol (`resources/read`, `prompts/get`). `groups/activate`
  and `groups/load` were rejected because they imply a server-side state
  transition the RPC does not perform.
- **Fields: `description` and `instructions`.** `description` keeps the
  base-protocol name every primitive already uses, scoped to when to select the
  group; `summary`, `selectionGuidance`, and `usage` were rejected.
  `instructions` is the optional "how", kept separate from the selection signal.

## Backward Compatibility

- The extension is net-new and, per the extensions model, disabled by default and
  opt-in on both sides. Servers and clients that never negotiate
  `io.modelcontextprotocol/groups` are wholly unaffected.
- No core method's request or response shape changes, and no core capability is
  added; negotiation happens entirely through the standard `extensions` fields.
- Extension evolution follows the [extensions guidance][ext-overview]: additive,
  backward-compatible changes are carried via the settings object or extension
  versioning; a breaking change, if unavoidable, would ship under a new
  identifier (e.g. `io.modelcontextprotocol/groups-v2`).

## Security Implications

- **Groups are untrusted model input, not directives.** Clients MUST surface
  scoped tools through the same authorization UX they use for top-level tools and
  MUST NOT auto-invoke scoped tools when a group is fetched.
- **Discovery gating is not access control.** Scoping keeps a tool out of `*/list`
  for discovery only; the tool remains invokable server-side whether or not its
  group was fetched. Servers MUST NOT rely on scoping or group membership to
  restrict access — sensitive tools MUST be protected by the server's normal
  authorization (see
  [Discovery gating is not access control](#discovery-gating-is-not-access-control)).
- **Name collisions are an impersonation surface.** Group names can collide across
  servers, and unspecified resolution lets a malicious server aim a well-known
  group name at whichever host resolves toward it; resolution MUST be
  deterministic — see [Naming and collisions](#naming-and-collisions). Within a
  single server, tool and prompt names MUST each be unique across top-level and
  scoped entries (resources are unique by URI), so a fetch cannot silently reroute
  a name to a different implementation — see
  [Placement and naming](#placement-and-naming).
- **Trust inherits MCP server trust.** Groups do not introduce a new trust model.
  A group carries the same level of trust as the server that delivers it. Hosts
  SHOULD NOT present MCP as a distribution channel for arbitrary third-party
  content.
- **Injection risk is the same as any agent-reachable primitive.** A group's
  instructions and scoped primitive descriptions are untrusted content the model
  will read, the same risk carried by tool descriptions, prompts, and resource
  contents today. `groups/get` is pull-only and has no auto-prefetch, so no new
  transport-level exposure is introduced; what changes is that the agent (not the
  user) decides when to pull in a group, and clients SHOULD NOT treat fetched
  instructions as privileged over any other untrusted content.
- **Listing a skill grants no approval.** A skill listed in a group's
  `resources` is still verified and approved under the Skills extension
  before it is loaded. Fetching the group does not activate the skill.
- **No filesystem execution chain.** Scoped actions run through ordinary
  `tools/call` invocations against server-owned tools, so the client makes no
  filesystem, base64, or subprocess assumptions.

## Responses to Expected Objections

### 1. "Isn't this just SEP-2084 with a new name?"

No. SEP-2084 modeled grouping as static membership metadata whose primary
consumer was client-side filtering and search. This extension's distinguishing
mechanic is on-demand, server-scoped disclosure: scoped primitives are absent
from every `*/list` and delivered as typed definitions only when the client
fetches the group with `groups/get`. That is server-authored progressive
disclosure — the server decides what a group contains and hands out its
definitions on demand — rather than a client-side filter over an already-loaded
catalog.

### 2. "Doesn't the Skills extension already solve this? How do the two relate?"

They work at different layers of the same workflow. The Skills extension
([SEP-2640]) is a transport binding for the
[Agent Skills specification](https://agentskills.io/specification): it serves a
skill's `SKILL.md` and supporting files as MCP resources and delegates the format
itself (directory layout, frontmatter, the progressive disclosure of content) to
that spec. The Agent Skills format is built for content, so it has no way to express
an MCP primitive. A `SKILL.md` can name a tool, but the format carries no typed
tool, prompt, or resource definition. A group is the MCP-native counterpart, built
to progressively disclose *MCP primitives*: the typed definitions of tools, prompts,
resources, and nested groups, on demand. The two line up rather than overlap:

- A **skill** covers the content: a workflow's prose, references, and assets,
  authored in the Agent Skills format and served as `skill://` resources.
- A **group** covers the primitives: the actual typed, invokable definitions,
  scoped per session. It can carry instructions alongside them.

A group is not a tools-only mechanism. Tools are the sharpest gap a skill leaves,
since a skill can describe a tool but never hand one over, but the same holds for
prompts, resources, and nested groups: a group discloses whatever primitives a
workflow depends on, together and scoped to the caller.

When a workflow needs both, the group lists the skill's `SKILL.md` by its URI
in `resources`, next to the tools, prompts, and resources the workflow
uses. The skill's other files come from its Skills entry, read on demand. The host
confirms and loads the skill through the Skills extension, the same way it would
any other explicit reference, so the authored skill stays the single source of
truth and keeps its verification and approval rules.

A group can also carry its own `instructions` without any skill. Those are group
guidance about the group's contents, not a skill. This doesn't make the two
compete: a group is useful with no skills in sight (a plain toolset, or a knowledge
bundle), and a skill is useful with no group. But when you have both, a group is
the natural place to disclose the workflow's primitives (see Rationale
§*Relationship to the Skills extension*).

### 3. "Should a skill be its own primitive?"

No. This extension adds no `Skill` object and no group type tag. A group that
carries instructions is a group with group guidance, not a skill; skill identity
comes only from the Skills extension (`skills/list`, or an explicit reference
confirmed with `skills/get`). Adding a dedicated skill primitive here would
single out one shape over the toolset and knowledge-bundle shapes the same
mechanism already covers, re-create the identity and discovery surface the
Skills extension already owns, and tie the two extensions together where a plain
reference by URI does the job. A host that wants to treat workflow groups
specially can still spot them from their shape or an optional `_meta` tag. Keeping `Group` uniform is what lets the one mechanism cover toolsets,
knowledge bundles, and skill-led workflows alike.

### 4. "Why not just serve all this through resources?"

- **Resources can't carry tools.** A group's payload is largely *executable*
  primitives — scoped tools and prompts — not files. Resources are read-only
  content, so a resources-based convention can at most *name* a group's tools in
  markdown body text and leave the client to reconcile those names against
  `tools/list`. `groups/get` instead returns the tool and prompt definitions
  themselves, as typed objects the client can invoke directly.
- **Namespace overloading.** A server's `resources/list` becomes a mix of content
  files and workflow bundles, and existing host features built around resources
  (@-mentions, attachments, pinned context, subscriptions) must now reason about
  which is which. A dedicated extension surface keeps these separate.
- **Upfront enumeration cost.** A group's instructions and reference files end up
  listed in `resources/list` alongside unrelated content. The scoped-primitive
  model here makes deferral the default: `groups/list` returns lightweight
  metadata, and `groups/get` fetches scoped definitions on demand.

### 5. "Clients should implement Tool Search to solve tool bloat."

See Rationale §*Progressive disclosure vs. tool search*. Tool search and groups
are complementary; requiring search as the only path to progressive discovery is
itself a prescription MCP's design principles counsel against.
