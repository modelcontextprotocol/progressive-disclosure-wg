# Examples

Runnable prototype of the [Progressive Disclosure via Groups](../seps/0000-progressive-disclosure-groups.md)
extension (`io.modelcontextprotocol/groups`), built on the
[`@modelcontextprotocol/ext-grouping`](../sdk/typescript) SDK.

- [`groups-server`](./groups-server/typescript) — a realistic "workspace
  assistant" server that advertises the extension. It keeps a few genuinely
  always-on utilities in `tools/list` (`web_search`, `read_url`, `send_message`,
  `echo`) and pushes the bulk of its capability behind five groups that cover
  every shape the extension supports:
  - `weather-forecaster` — a **skill**: instructions plus the scoped tools they
    orchestrate (`get_weather`, `get_forecast`, `get_severe_alerts`).
  - `calendar` — a **toolset**: scoped tools with *no* instructions
    (`list_events`, `find_availability`, `create_event`, `cancel_event`).
  - `knowledge-base` — a **knowledge bundle**: instructions plus scoped
    resources, no tools.
  - `crm` — a skill for customer lookup, account summaries, and tickets.
  - `travel-booking` — a skill for searching flights/hotels and booking an
    itinerary.
- [`groups-client`](./groups-client/typescript) — a minimal client that calls
  `groups/list`, then `groups/get`, and invokes the scoped tools/resources the
  fetch reveals.
- [`groups-agent`](./groups-agent/typescript) — a Claude agent (Vertex AI) that
  lets the model discover and open groups itself, and **measures the prompt
  cache** to show group tools can be disclosed on demand without busting it.
- [`groups-mod`](./groups-mod) — a **Claude Code mod** (engine-level plugin) that
  brings groups-style progressive disclosure into Claude Code itself: it exposes
  `list_groups`/`open_group`, and on open reveals a group's scoped tools
  mid-session as **deferred** definitions so they stay cache-safe and directly
  callable. Different kind of example (a Claude Code plugin, not an MCP
  client/server) — see [its own section](#groups-mod-claude-code-plugin).

The client and agent each launch the server themselves over stdio, so you run
**only the client** (or the agent) — no need to start the server separately.

## Prerequisites

Node.js 20+ and npm.

## Setup (first time only)

Each package installs its dependencies; the examples link the local SDK via a
`file:` dependency.

```bash
# from the repo root
cd sdk/typescript && npm install && cd ../../
cd examples/groups-server/typescript && npm install && cd ../../../
cd examples/groups-client/typescript && npm install && cd ../../../
```

## Build

Build order matters: the examples import the SDK's compiled output, and the
client spawns the server's compiled output by path.

```bash
# from the repo root
cd sdk/typescript && npm run build && cd ../../                          # 1. SDK
cd examples/groups-server/typescript && npm run build && cd ../../../    # 2. server
cd examples/groups-client/typescript && npm run build && cd ../../../    # 3. client
```

## Run

```bash
# from the repo root
cd examples/groups-client/typescript && npm start        # or: node dist/index.js
```

You should see `groups/list` return the three groups, followed by a
`groups/get` round-trip for each — note that `calendar`'s response returns
`contents` with no `instructions` field.

## Running groups-agent

[`groups-agent`](./groups-agent/typescript) is a real Claude agentic loop: the
model discovers and opens groups itself, and the agent prints a per-turn
**prompt-cache report** to show disclosure staying cache-safe. The essentials:

**Build** (SDK → server → agent — the agent spawns the compiled server):

```bash
# from the repo root
cd sdk/typescript && npm run build && cd ../../
cd examples/groups-server/typescript && npm install && npm run build && cd ../../../
cd examples/groups-agent/typescript && npm install && npm run build && cd ../../../
```

**Auth.** It calls **Claude Opus 4.8** through one of two providers, chosen
automatically: set `ANTHROPIC_API_KEY` to use the Claude API, or leave it unset
to fall back to Claude on Vertex AI (Google Application Default Credentials). The
Vertex path requires `ANTHROPIC_VERTEX_PROJECT_ID`:

```bash
# Claude API
export ANTHROPIC_API_KEY=...

# or Vertex AI
export ANTHROPIC_VERTEX_PROJECT_ID=your-gcp-project
gcloud auth application-default login
```

**Run** (from the repo root):

```bash
cd examples/groups-agent/typescript
npm start
```

The agent prints each tool the model calls, then the cache report.

## Rebuilding after edits

- Changed the **SDK**? Rebuild it *and* both examples (they consume its `dist/`).
- Changed the **server**? Rebuild the server before rerunning the client.
- Changed the **client**? Rebuild the client.

> Running `node groups-server/typescript/dist/index.js` on its own just waits on
> stdio for a client to connect. Drive it through the client (or an MCP
> inspector) instead.

## groups-mod (Claude Code plugin)

[`groups-mod`](./groups-mod) is not an MCP client/server — it is a Claude Code
**mod** (an engine-level plugin, `register(on)` hooking engine events). It adds
Groups-style progressive disclosure to Claude Code itself and was used to
investigate whether a mod can disclose tools **without busting the prompt
cache**.

**How it works**

- At `session.start` it registers two always-on tools, `list_groups` and
  `open_group`.
- When the model calls `open_group`, it registers that group's scoped tools
  mid-session and marks them **deferred** via `tool.describe → isDeferred: true`.
  It populates its lookup maps **before** calling `$.tool.register` — the engine
  can fire `tool.describe` during registration, and if the map doesn't yet list
  the tool it registers *resident* and busts the cache.
- Scoped tool calls are answered by the mod itself with canned results.

**Requirements**

The function-hook mod system needs **Claude Code ≥ 2.1.283** and
`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, plus a supported model (e.g. Opus 4.8).
Run the latest via `npx` — older installed builds reject the mod format:

```bash
# from the repo root
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 ENABLE_TOOL_SEARCH=false \
  npx -y @anthropic-ai/claude-code@latest \
    --plugin-dir examples/groups-mod \
    --permission-mode bypassPermissions
```

Then, e.g.: *"Open the weather-forecaster group, then get the weather in
Cambridge."* Check `/mcp` to watch the `groups` plugin gain its scoped tools as
each group is opened.
