# Deterministic Domain Manifests in Apache Doris MCP Server

## Summary

[Apache Doris MCP Server](https://github.com/apache/doris-mcp-server) 1.0.0
implements a server-side progressive-disclosure pattern for a catalog of 55
read-only operations. The server exposes eight stable domain tools by default.
Calling one domain with an empty object returns an authorization-aware manifest
containing the exact names and schemas of that domain's child operations. A
subsequent call to the same domain names one child explicitly and supplies the
arguments validated against that child's schema.

The implementation does not use semantic search, fuzzy matching, probabilistic
routing, or conversational mutation of the registered top-level tool set. A
client can move from one domain to another immediately because all eight domain
entrypoints remain registered for the lifetime of the MCP connection.

This pattern substantially reduces the initial serialized tool payload and
provides a compatibility strategy. It also exposes an important protocol gap: a
host that understands MCP but not this application-specific convention sees
child definitions as tool-result data rather than as provider-native tools.
Interoperable progressive discovery therefore needs a standard way for a client
to retrieve exact tool definitions on demand and activate them in the model's
native tool interface.

The implementation and measurements below refer to Apache Doris MCP Server
commit [`5daf1deb26bc0db02c19bf5ca1d070acea4cfab9`](https://github.com/apache/doris-mcp-server/commit/5daf1deb26bc0db02c19bf5ca1d070acea4cfab9),
a post-1.0.0 maintenance snapshot of the 1.0 architecture. The published
`1.0.0` tag points to
[`953c3b6c5bbabb297f3ca625a42912c93dc06471`](https://github.com/apache/doris-mcp-server/commit/953c3b6c5bbabb297f3ca625a42912c93dc06471).

## Motivation and constraints

Apache Doris exposes metadata, query, cluster, ingestion, governance, lakehouse,
search, and semantic capabilities. A useful MCP integration needs broad coverage,
but eagerly registering every exact operation creates several problems:

- every model request may carry descriptions and JSON Schemas for operations that
  are unrelated to the current task;
- overlapping operational concepts make selection harder as the flat catalog
  grows;
- availability depends on the connected Doris version, distribution, runtime
  probes, optional providers, and caller authorization;
- a server-side semantic router can hide errors by selecting a plausible but
  incorrect operation;
- a conversationally changing `tools/list` result complicates host caches and is
  inconsistent with the stable connection behavior expected by the MCP tools
  contract.

The design therefore uses a stable first level, exact second-level selection,
and fail-closed execution.

## Implemented interaction

### 1. Stable domain registration

In hierarchical mode, `tools/list` returns exactly eight read-only domain tools:

- `doris_catalog`
- `doris_query`
- `doris_cluster`
- `doris_pipeline`
- `doris_governance`
- `doris_search`
- `doris_lakehouse`
- `doris_semantic`

Each description states the domain boundary and tells the model to call the
domain with an empty object before selecting a child. Child names and parameter
schemas are deliberately omitted from the top-level descriptions.

The source of truth is the
[`DORIS_DOMAIN_CATALOG`](https://github.com/apache/doris-mcp-server/blob/5daf1deb26bc0db02c19bf5ca1d070acea4cfab9/doris_mcp_server/tools/domain_catalog.py).
The same catalog generates hierarchical manifests, flat tools, authorization
identifiers, handler bindings, documentation, and contract tests.

### 2. Bounded manifest discovery

An empty call discovers one domain:

```json
{
  "name": "doris_catalog",
  "arguments": {}
}
```

The result contains:

- the domain identifier;
- a deterministic `manifest_version`;
- exact child names and descriptions;
- exact input and output schemas;
- read-only and behavioral annotations;
- version-support information;
- structured runtime availability, including `callable`, status, reason code,
  active implementation variant, and evidence sources.

Manifest size, description length, schema size, and enum cardinality are bounded
by the implementation. Authorization filtering occurs before a child is
disclosed. Runtime capability filtering does not silently remove a known,
authorized child: the manifest can retain it with `callable=false` and a stable
reason code so the host can explain why the capability is unavailable.

The implementation is in
[`domain_manifest.py`](https://github.com/apache/doris-mcp-server/blob/5daf1deb26bc0db02c19bf5ca1d070acea4cfab9/doris_mcp_server/tools/domain_manifest.py).

### 3. Exact child invocation

After discovery, the host calls the same domain with the exact child name,
arguments, and discovered generation:

```json
{
  "name": "doris_catalog",
  "arguments": {
    "child_tool": "list_tables",
    "arguments": {
      "database": "analytics"
    },
    "manifest_version": "catalog.<content-hash>"
  }
}
```

The server validates the outer request, authorization, manifest generation,
child availability, child input Schema, execution result, and child output
Schema. An outdated generation fails with `CHILD_MANIFEST_STALE` and tells the
host to rediscover the domain. Unknown and unauthorized children share the same
public not-found behavior.

Both hierarchical and flat calls converge on the exact same binding and handler
path in
[`domain_dispatcher.py`](https://github.com/apache/doris-mcp-server/blob/5daf1deb26bc0db02c19bf5ca1d070acea4cfab9/doris_mcp_server/tools/domain_dispatcher.py).

### 4. Flat compatibility mode

Hosts that cannot perform a discovery step before selecting a final operation
can start the server in `flat` mode. The server then exposes all 55 formal child
tools, for example `doris_catalog_list_tables`, through ordinary `tools/list` and
`tools/call` behavior.

Flat mode is a startup-level compatibility choice. It does not change in response
to conversation turns and does not bypass authorization or availability checks.

The host contract and fallback are documented in
[`docs/integrations/hosts.md`](https://github.com/apache/doris-mcp-server/blob/5daf1deb26bc0db02c19bf5ca1d070acea4cfab9/docs/integrations/hosts.md).

## Fast intent switching

The stable domain set avoids re-registration when a conversation changes topic:

1. The user asks which tables exist.
2. The model discovers `doris_catalog` and selects `list_tables`.
3. The user asks whether the cluster is healthy.
4. The model discovers the already registered `doris_cluster` domain and selects
   `get_cluster_overview`.

The server does not infer that the second question belongs to the cluster domain.
The model selects the registered domain explicitly, sees the complete authorized
manifest for that domain, and then selects the exact child explicitly.

## Payload measurement

The following measurement serializes MCP `Tool` objects as compact, sorted JSON
using Pydantic's JSON representation. All 55 children were marked available by a
fixed measurement provider so that runtime probe differences could not change
the comparison.

Environment:

- Apache Doris MCP Server commit: `5daf1deb26bc0db02c19bf5ca1d070acea4cfab9`
- Python: `3.12.11`
- catalog: 8 domains and 55 children
- measurement unit: UTF-8 serialized bytes, not model tokens

| Payload | Tool or child count | Serialized bytes |
| --- | ---: | ---: |
| Hierarchical `tools/list` | 8 domains | 22,873 |
| Flat `tools/list` | 55 tools | 156,455 |
| `doris_catalog` manifest | 5 children | 4,163 |
| `doris_cluster` manifest | 11 children | 9,015 |
| `doris_semantic` manifest | 12 children | 11,443 |

The flat list was 6.84 times the size of the hierarchical top-level list. A
working set containing the top-level list plus one selected domain measured:

| Selected domain | Working-set bytes | Reduction from flat list |
| --- | ---: | ---: |
| Catalog | 27,036 | 82.7% |
| Cluster | 31,888 | 79.6% |
| Semantic | 34,316 | 78.1% |

These numbers measure protocol-object serialization only. They do not claim an
equivalent reduction in billed tokens, latency, or tool-selection errors. Those
outcomes depend on the host, model provider, prompt construction, caching, and
conversation state and require separate end-to-end evaluation.

## Verification coverage

The public test suite covers the following properties:

- exact and stable 8-domain/55-child catalog shape;
- deterministic manifests across repeated calls and worker processes;
- content-sensitive manifest generations that ignore timestamps;
- bounded descriptions and schemas;
- authorization filtering before disclosure;
- structured availability and matching description prefixes;
- stale-manifest rejection;
- identical exact handler execution in hierarchical and flat modes;
- MCP protocol serialization for discovery and execution.

The focused command below completed with `195 passed` against the referenced
snapshot. It is a contract and protocol test subset; it is not presented as a
full repository gate or a live-host end-to-end result.

Relevant tests include
[`test_domain_manifest.py`](https://github.com/apache/doris-mcp-server/blob/5daf1deb26bc0db02c19bf5ca1d070acea4cfab9/test/tools/test_domain_manifest.py),
[`test_domain_dispatcher.py`](https://github.com/apache/doris-mcp-server/blob/5daf1deb26bc0db02c19bf5ca1d070acea4cfab9/test/tools/test_domain_dispatcher.py),
[`test_host_exposure_contract.py`](https://github.com/apache/doris-mcp-server/blob/5daf1deb26bc0db02c19bf5ca1d070acea4cfab9/test/tools/test_host_exposure_contract.py),
and
[`test_mcp_v2_protocol.py`](https://github.com/apache/doris-mcp-server/blob/5daf1deb26bc0db02c19bf5ca1d070acea4cfab9/test/protocol/test_mcp_v2_protocol.py).

To reproduce the focused contract suite:

```bash
git clone https://github.com/apache/doris-mcp-server.git
cd doris-mcp-server
git checkout 5daf1deb26bc0db02c19bf5ca1d070acea4cfab9
uv sync --frozen --group dev
uv run pytest --no-cov -q \
  test/tools/test_domain_catalog.py \
  test/tools/test_domain_manifest.py \
  test/tools/test_domain_dispatcher.py \
  test/tools/test_host_exposure_contract.py \
  test/protocol/test_mcp_v2_protocol.py
```

## What worked

- A small, stable set of domain entrypoints keeps every broad capability area
  reachable without carrying every child Schema initially.
- Exact domain and child identifiers keep correctness independent of a search
  algorithm.
- Domain manifests are natural boundaries for authorization and capability
  evidence.
- A content-derived generation makes stale discovery fail closed.
- A single catalog and execution path prevent hierarchical and flat modes from
  drifting apart.
- Startup-level flat fallback preserves compatibility with hosts that cannot run
  the hierarchical sequence.

## What did not become interoperable

The discovered children are returned as structured tool-result data. They are not
independent MCP `Tool` records in the original `tools/list` response. A host that
does not understand this pattern cannot automatically place those exact schemas
in its model provider's native tool interface.

Consequences include:

- native provider validation and tool identity apply to the generic domain tool,
  not directly to the selected child;
- the server must validate the child contract again at runtime;
- every server could invent a different manifest and dispatch envelope;
- host support remains application-specific;
- flat mode is still required for clients that cannot perform an intermediate
  discovery step.

This is the principal reason the server-side pattern should be treated as
experimental evidence rather than a final wire-level design.

## Relationship to current community work

The experiment directly supports the progressive-discovery priority in the
[MCP roadmap](https://modelcontextprotocol.io/development/roadmap). It also
provides implementation evidence for the active Primitive Grouping IG work:

- the proposed
  [progressive-discovery problem statement](https://github.com/modelcontextprotocol/experimental-ext-grouping/pull/14)
  identifies the need to keep the active catalog small without making the wider
  catalog unreachable;
- the proposed
  [limits-of-tool-search analysis](https://github.com/modelcontextprotocol/experimental-ext-grouping/pull/15)
  explains why search alone cannot provide native tool activation, deterministic
  reachability, or portable behavior;
- [SEP-2636](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2636)
  proposes the compatible `tools/catalog` and `tools/describe` separation.

The goal of this finding is to contribute data and constraints to that work, not
to introduce a competing protocol proposal.

## Protocol implications

The experiment supports separating three concerns:

1. **Compact discovery:** expose a stable, authorization-filtered catalog that is
   cheap enough to keep available.
2. **Exact description:** retrieve complete native `Tool` definitions by exact
   group and/or exact tool names, without requiring semantic search.
3. **Native activation and invocation:** let the host activate the described
   tools in the model's native tool interface and invoke them through ordinary
   `tools/call` with their exact names.

This direction is compatible with the `tools/catalog` and `tools/describe`
separation proposed in
[SEP-2636](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2636).
The Doris experiment adds evidence for a deterministic grouping layer:

- discovery by exact group identifier should be sufficient for correctness;
- free-text or semantic search may be an optional convenience, not a required
  routing mechanism;
- group membership and schemas need independently cacheable generations or
  hashes;
- authorization must be applied before catalog or Schema disclosure;
- availability metadata can explain version, provider, configuration, and
  runtime limitations without pretending the tool is callable;
- legacy clients need an ordinary full `tools/list` fallback;
- the protocol or SDK guidance must define how a host turns described tools into
  a provider-native active tool set.

## Open questions

1. Should groups be a first-class MCP primitive, or compact metadata attached to
   catalog entries?
2. Should `tools/describe` accept exact group identifiers, exact tool names, or
   both?
3. How should clients expose a compact group catalog to a model without defining
   a provider-specific host tool?
4. Which changes invalidate group membership, catalog summaries, full schemas,
   authorization views, and runtime availability independently?
5. Should an authorized but unavailable tool remain discoverable with structured
   availability, or be omitted from the callable set after description?
6. How can conformance tests verify that a host activates exact native tools
   rather than passing schemas through untyped prompt text?
7. What payload, accuracy, and latency benchmarks are portable enough to compare
   approaches across models and hosts?

## Conclusion

Deterministic domain manifests are a practical server-side bridge for hosts that
can perform a two-step selection flow. They reduce the initial catalog payload,
keep broad capabilities reachable, and avoid making probabilistic search part of
the correctness path. Their interoperability limit is equally clear: discovered
children need a standard path back into the host's native tool interface.

The experiment therefore supports a protocol-level progressive-discovery
mechanism that combines compact grouping, exact description, cache-safe
generations, authorization-aware disclosure, native activation, and an ordinary
flat fallback.
