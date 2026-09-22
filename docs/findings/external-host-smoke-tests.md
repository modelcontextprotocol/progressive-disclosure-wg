# Exploratory external Host and model observations

These bounded tests were performed on 2026-09-22 against the synthetic three-tool
fixture at `c3fa2a9475bc9dd47ae19643b48d9b0a24f5a43d`. They illustrate different
acquisition and activation paths; they are not a comprehensive client survey,
official conformance certification or a comparative model benchmark.

| Configuration                                     | Observed acquisition/activation                                                                                        | Outcome                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Kimi CLI 2.0.2, default                           | `tools/list`, followed by three `tools/call` requests                                                                  | All three returned fixture acknowledgments      |
| Kimi CLI 2.0.2, deferred enabled                  | `tools/list`; model called built-in `select_tools` with exact names, then three MCP calls                              | Exact-name deferred loading and calls completed |
| Codex CLI 0.153.4, isolated process configuration | `tools/list`, followed by three `tools/call` requests                                                                  | All three returned fixture acknowledgments      |
| DeepSeek API through the custom reference Host    | Model selected query, then operations; Host changed provider-facing definitions and retained original invocation names | Three-turn selection/call sequence completed    |

Kimi requested MCP protocol `2025-11-25`; Codex requested `2025-06-18`. Neither CLI
run invoked draft manifest/describe or experimental group methods. This is an
observation of the tested configuration, not a claim that other configurations
cannot support progressive loading. The DeepSeek request used `deepseek-chat`;
the API reported `deepseek-flash`. Codex request metadata identified `gpt-6-astra`.

## Reproduction conditions

Use the fixture in `experiments/deterministic-groups/conformance/fixture.json`
and the SDK stdio bridge with all three names authorized. For Kimi, compare a
fresh session with `deferred: false` and `KIMI_CODE_EXPERIMENTAL_TOOL_SELECT=0`
against one with `deferred: true` and the flag set to 1. The current model must
support dynamic loading as described in the
[Kimi MCP documentation](https://moonshotai.github.io/kimi-code/en/customization/mcp.html).
Both runs used the same prompt, directory and CLI binary. Codex used a read-only,
ephemeral invocation with process-only MCP configuration and `--ignore-user-config`
after conflicts with the existing desktop configuration. Global config files
were not edited; no bypass-sandbox, ignore-rules or bypass-hook-trust flag was used.
See the [Codex MCP documentation](https://developers.openai.com/codex/mcp/).

CLI prompt:

> Please inspect the available tables, then check cluster health, and finally
> retrieve the server version. Use only the connected grouping-fixture read-only
> MCP tools and report exactly what evidence they return. Do not inspect files,
> run shell commands, or delegate.

The API experiment used three separate user turns requesting those operations.
A custom `select_group` provider tool selected exact domain IDs and called the
reference Host's activation method; this was **not native DeepSeek MCP support**.
Only that selection tool was initially exposed. Subsequent model requests included
the selected domain's native-shaped tool definitions. This extra Host intervention
means the API run is not directly comparable to the CLI defaults.

All tool responses were literal `Executed <name>` strings. Models accurately
reported the absence of database facts. There was one controlled run per CLI mode
and one three-turn API run, not a reliability or statistical accuracy study.
Private session identifiers, credentials, raw logs and workstation configurations
are intentionally excluded from this public summary. The observations are manually
reported external smoke evidence, not results reproduced by CI.

## Implications for the experiment

Separate wire acquisition, grouping, and model activation. Kimi's deferred run
demonstrates exact-name loading while still fetching the ordinary tool list.
It does not demonstrate selective wire acquisition or our grouping extension.
The two Kimi configurations sent the same initialization capabilities, so absence
of a client activation flag cannot establish absence of lazy loading.

Keep `tools/list` unchanged. Explicit server extension negotiation remains needed;
mandatory bidirectional activation flags require a concrete use case and community
review rather than inference from these tests. Do not special-case client brands.

Open validation work includes independent implementation interop, large-catalog
costs, pagination, autonomous invalidation, provider-facing revocation and repeated
natural-language tasks. These observations do not measure token savings, latency,
or native grouping adoption, and do not establish a defect in either CLI.
