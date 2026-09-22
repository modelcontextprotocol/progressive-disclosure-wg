# Deterministic grouping: experimental contract and reference

See the [synthetic payload benchmark](BENCHMARK.md) for reproducible narrow,
dispersed and full-catalog comparisons, including cases where grouping costs more.

This is a discussion artifact, **not an accepted MCP extension**. It layers
single-level exact group selection on the manifest/describe split in
[SEP-2636](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2636),
pinned to revision `2e5b9245e8c4026f6097f325e2d09d7eeb041e03`.
The separate [Doris findings](../../docs/findings/doris-domain-manifests.md)
motivate this experiment; the fixture does not access Doris.

## Run

Node.js 20 or newer, no installation or credentials required:

```sh
node --test experiments/deterministic-groups/reference.test.mjs
```

`reference.mjs` exports a reference Server, Host, and independent three-tool
fixture. Requests and responses cross an in-process JSON serialization boundary.
Tests record the requests, inspect provider-facing definitions, invoke the
original names, inject changes, and check recovery.

The [portable check contract](conformance/README.md) adds a JSON fixture, shared
serialization vectors and an asynchronous adapter interface for other server
implementations. It separately lists unimplemented integration gates and includes
negative controls for the test harness itself.

The [SDK stdio bridge](../../sdk/typescript/experiments/grouping/README.md)
runs the same portable contract through real SDK Client/Server instances in
separate processes and tests change notification delivery. It reuses the reference
business logic and is not a second independent implementation.

## Proposed contract

The words below describe this experiment, not requirements on existing MCP hosts.
All names under `experimental/` are provisional and require community review.

1. A server advertises `tools.manifest: true` and experimental capability
   `experimental/deterministic-groups: {version: 1}`. Neither capability is assumed
   from a server name. Unsupported hosts keep using `tools/list` unchanged.
2. `experimental/groups/list` returns `{groups, revision}`. Each group has an exact
   stable `id`, a short `description`, and an authorized member `count`. It carries
   no full tool schemas. Empty authorized groups are omitted, including groups
   whose members are all hidden. Group descriptions must themselves be safe for
   every principal allowed to discover that group.
3. `experimental/groups/expand` accepts `{id, revision}` and returns compact
   `{entries, revision}` for that exact group. Entries retain SEP-2636 shapes;
   this method does not change the set semantics of `tools/manifest`. Unknown and
   unauthorized-only groups both return invalid params with `reason: unknownGroup`.
   A stale revision returns invalid params with `reason: staleView`.
4. Membership is authoritative in the full Tool's
   `_meta["experimental/deterministic-groups"].groups`, an array of exact IDs.
   One tool can belong to several groups but keeps one MCP name and definition.
   The server's group expansion must agree with that metadata. No semantic search,
   approximate name resolution, or implicit alternative group is required.
5. Selected entries are fetched by standard draft `tools/describe({names})`.
   Host verifies names, ordering, complete response, sizes and whole-Tool digests
   before activation. The prototype uses batches of at most 50 definitions.
6. Host retains the complete MCP definitions for policy and audit, adapts the input
   schema into the provider's native shape, and invokes `tools/call` using the
   original name. An adapter unable to preserve schema semantics must refuse
   activation rather than silently weaken constraints. The included adapter is
   illustrative and does not contact a provider.
7. Authorization is enforced on every server operation. It is never obtained by
   selecting a group. Hidden tools are absent from list, manifest and expansion;
   describe and call treat their names as unknown. Session identity is transport
   supplied, never a model-controlled request argument.
8. Stable availability is `_meta[...].callable`. An authorized unavailable tool
   remains discoverable and describable but is not activated. Calls recheck
   availability and authorization. Volatile telemetry is out of scope.

## Host lifecycle and freshness

```text
negotiate -> list authorized groups -> expand exact ID at revision
          -> describe exact names -> verify -> adapt -> activate -> tools/call
                 any discovery failure -> clear activation -> rediscover
```

The prototype revision hashes the authorized compact entries plus the visible
group directory. Consequently schema, membership, availability, group text and
authorized name-set changes invalidate the view, even when surviving Tool bytes
are unchanged. It is a session-local freshness token, not proof of authenticity
or authorization, and must not be reused across authenticated sessions.

The reference conservatively re-reads discovery on every activation and verifies
the revision again after describe. It clears previous registrations before a
switch, and never installs a partial batch. Concurrent changes fail closed;
explicit retry starts discovery again. This avoids an unbounded retry loop.

A transport integration should map tool definition/set changes to
`notifications/tools/list_changed` and define a separate directory-change signal
for group-only description changes. On notification, TTL expiry, reconnect or
identity change the host must invalidate/reconcile active definitions before the
next provider turn. `Host.invalidate()` models that boundary; notification delivery
and TTL scheduling are **not implemented** here. No stale-generation parameter is
added to standard `tools/call`; a post-activation race still requires authoritative
server argument validation and authorization. This is not atomic discovery-to-call.

## Executable coverage

| Contract area                       | Test evidence                                                   |
| ----------------------------------- | --------------------------------------------------------------- |
| Exact selection and native identity | Only selected schemas described; original name invoked          |
| Multiple groups                     | Same tool object; explicit switch removes prior registrations   |
| Authorization                       | Set equality, hidden-only group omission, unknown-name behavior |
| Describe contract                   | Ordered/atomic response, empty input and batch bound            |
| Invalidation                        | Membership, schema, authorization, availability, text, removal  |
| Races and recovery                  | Changes during describe and final check; explicit retry         |
| Bad responses                       | Altered definition, reversed order, incorrect size              |
| Availability                        | Discoverable but inactive; server recheck after activation      |
| Compatibility                       | Grouping or manifest absent: unchanged tools/list path          |
| Batch handling                      | 51 tools fetched in two bounded describe requests               |

## Boundaries and next review decisions

- This is a synchronous state-machine/wire-shape model, not an SDK-integrated
  server, production authentication implementation, network transport, real
  provider test, or official conformance suite. The initialization response models
  only relevant capabilities, not the full MCP handshake.
- Canonical serialization is sufficient for this ASCII-key, JSON-safe fixture.
  Cross-language numbers and non-BMP key sorting require shared canonicalization
  vectors and resolution of the SEP's Unicode-code-point vs RFC 8785 wording.
  Do not use this serializer as a certified general-purpose RFC 8785 library.
- The fixture only accepts empty-object call arguments. Arbitrary JSON Schema,
  output validation, approvals and execution sandboxing belong in the integration.
- Directory/expansion pagination, payload budgets, persistent cache partitions,
  push notifications and asynchronous transport races need follow-up implementation.
  The full standard manifest remains available; the grouping path avoids fetching
  it wholesale but the fixture server still computes its view from all visible tools.
- Review method placement, namespaced metadata, change signals, and pagination
  with the working group before stabilizing a wire extension. Add shared vectors
  and a second independent implementation before claiming interoperability.
- No token, latency, model selection accuracy or wire-cost improvement is claimed
  from this fixture. The Doris measurements remain a separate pinned experiment.

The scope follows the [ownership plan](https://github.com/modelcontextprotocol/progressive-disclosure-wg/pull/16#issuecomment-5771293940)
and [SEP author feedback](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2636#issuecomment-5643895621).
