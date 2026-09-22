# Synthetic discovery payload comparison

This reproducible experiment compares actual JSON-RPC-shaped requests and responses
from the reference handlers. It is an **in-process serialized payload measurement**,
not a network throughput, latency, token, CPU or model selection benchmark.

```sh
node --test experiments/deterministic-groups/benchmark.test.mjs
node experiments/deterministic-groups/benchmark.mjs --check experiments/deterministic-groups/benchmark-results.json
```

To regenerate the checked-in machine-readable report, replace `--check` and its
argument with the output path. The generator and reference implementation in the
same checkout define the measured source; no live Doris instance is involved.

## Contract and accounting

- Sizes: 100, 1,000 and 10,000 tools, ten tools per single-level group. Each tool
  has eight string filter fields and repeated explanatory text; this schema-heavy,
  uniform synthetic distribution is deliberately explicit, not industry telemetry.
- Selections: ten tools in one group; ten spread across ten groups; all tools.
  All target names and groups are known to the scenario in advance. No discovery
  quality, semantic search or model inference cost is measured.
- Paths: flat `tools/list`; full compact manifest plus selected describe batches;
  group directory plus exact expansions and selected describe batches. Grouping
  does not fetch unrequested definitions merely because they share a group.
- Each path has its own cache and follows four sequential stages: cold, unchanged
  refresh, one requested definition changed, then 10% authorization revocation.
  Rows describe the incremental work of that stage, not cumulative bytes.
- The all-tools scenario requests everything in one synchronization; it is not
  a measured sequence of independent model turns eventually visiting every group.
- Count compact UTF-8 serialized request **and** response envelopes, including IDs,
  names, hashes and the group's final revision recheck. Exclude initialization,
  notifications, compression, transport framing, execution and provider traffic.
- Definitions counts full Tool objects transferred, not manifest entries. Requests
  count RPC exchanges, not measured network round trips under concurrency.
- Describe batches are capped at 50. Lists and expansions are unpaginated, as in
  the current reference. A production pagination design will change these counts.
- The server's immutable per-stage view is memoized only to avoid repeated CPU
  work. It still represents all visible tools. This does not establish efficient
  server-side lookup or incremental hashing.
- Group paths re-fetch the directory at the end to reject stale discovery. The
  snapshot is stable within each stage; concurrent mutations are separate tests.
- After every stage, exact target definitions are checked against the fixture and
  revoked cached names are rejected. Unknown/hidden targets are not silently counted
  as usable. Selection cache eviction is conservative for groups outside the scope.

## Example: 10,000 tools, cold acquisition

| Selection        | Path     | Total bytes | RPC requests | Full definitions |
| ---------------- | -------- | ----------: | -----------: | ---------------: |
| Ten in one group | Flat     |  12,598,981 |            1 |           10,000 |
| Ten in one group | Manifest |   1,542,913 |            2 |               10 |
| Ten in one group | Grouped  |     169,037 |            4 |               10 |
| Ten dispersed    | Flat     |  12,598,981 |            1 |           10,000 |
| Ten dispersed    | Manifest |   1,542,940 |            2 |               10 |
| Ten dispersed    | Grouped  |     185,623 |           13 |               10 |
| All              | Flat     |  12,598,981 |            1 |           10,000 |
| All              | Manifest |  14,282,775 |          201 |           10,000 |
| All              | Grouped  |  14,750,470 |        1,202 |           10,000 |

The full report has 108 rows, including all sizes and refresh stages. Warm unchanged
manifest/grouped paths transfer zero full definitions; a one-definition change
transfers one. Authorization removal transfers no new full definitions in these
cached selective paths while evicting revoked definitions. Their indexes still cost
bytes and requests; zero definition transfer is not zero refresh cost.

## Interpretation and limits

Grouping lowers compact-index transfer for narrow exact selections in this fixture.
It adds directory, expansion and validation work. When everything is needed, flat
listing is cheaper at cold start, and grouped discovery is especially request-heavy.
Cross-group selections incur more exchanges than same-group selections. These
unfavorable cases are part of the result, not excluded outliers.

This supports keeping flat compatibility and choosing acquisition strategies based
on use, not forcing every Host into grouping. Other group sizes, overlapping
memberships, smaller schemas, directory summaries, pagination, multiple sessions
and asynchronous updates need separate measurements. No claim of universal savings,
real-world latency improvement or token reduction follows from these bytes.
