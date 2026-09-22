# Experimental Findings
[Problem Statement](problem-statement.md) |
[Use Cases](use-cases.md) |
[Approaches](approaches.md) |
[Open Questions](open-questions.md) |
Experimental Findings |
[Related Work](related-work.md) |
[Contributing](../CONTRIBUTING.md)

## Implementations

- [Exploratory external Host and model observations](findings/external-host-smoke-tests.md)
  separates flat compatibility, exact-name deferred loading and custom Host activation,
  with explicit sample sizes and evidence limits.

- [Deterministic domain manifests in Apache Doris MCP Server](findings/doris-domain-manifests.md)
  describes a public server implementation's bounded, deterministic alternative
  to eager exposure of 55 tool schemas, including measurements, limitations, and
  protocol implications.

- [Deterministic grouping contract and reference Host/Server](../experiments/deterministic-groups/README.md)
  layers an experimental exact-group discovery surface on SEP-2636, with executable
  authorization, freshness, activation and compatibility scenarios. This is an
  in-process prototype, not an accepted extension or SDK conformance claim.
