/**
 * Minimal Claude agent that proves the Groups SEP
 * (`io.modelcontextprotocol/groups`) can disclose a group's scoped tools
 * on demand WITHOUT busting the provider prompt cache.
 *
 * The SEP's "Prompt caching" section claims:
 *
 *   > Clients that add tools at the END of the model's context invalidate
 *   > cache only from the insertion point forward, not the whole prefix;
 *   > surfacing a group's tools is a bounded, amortized cost, not a full bust.
 *
 * This agent tests that claim directly against Anthropic's mid-conversation
 * tool-change feature (beta `inline-tools-2026-09-15`):
 *
 *   - The `tools` array (the very front of the cached prefix) is STATIC:
 *     the top-level `echo` tool plus two client-side helpers,
 *     `list_groups` and `get_group`.
 *   - When the model opens a group via `get_group`, its scoped tools are
 *     surfaced by appending `tool_addition` blocks inside a mid-conversation
 *     `role: "system"` message — i.e. at the END of the context, after the
 *     cache breakpoints — so the cached prefix is untouched.
 *
 * A per-turn cache report shows the cost of disclosure staying bounded.
 */
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { GroupsClient } from "@modelcontextprotocol/ext-grouping";
import { randomUUID } from "crypto";
import * as path from "path";
import * as url from "url";

// Provider selection: use a Claude API key when ANTHROPIC_API_KEY is set,
// otherwise fall back to Claude on Vertex AI (Google ADC). Model IDs are bare
// (no `anthropic.` prefix) on both.
const USE_API_KEY = !!process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-opus-4-8";
const BETA = "inline-tools-2026-09-15";
// Required when using the Vertex AI provider (no default).
const VERTEX_PROJECT = process.env.ANTHROPIC_VERTEX_PROJECT_ID;
const VERTEX_REGION = process.env.CLOUD_ML_REGION ?? "global";

// The scripted task forces the agent to discover and open two groups
// (weather-forecaster, calendar) and then call their scoped tools —
// keeping the proof deterministic and reproducible.
const TASK =
  "Three things: (1) what's the weather in Cambridge and is there anything " +
  "severe I should know about, (2) am I free on 2026-08-17 for a 30-minute " +
  "sync, and (3) what's the account status for the customer 'Acme'? " +
  "Give me a short answer for each.";

// A realistic production-style system prompt for a workspace assistant. This is
// the kind of prompt a real deployment ships — role, the progressive-disclosure
// protocol, tool discipline, verification, and output rules. It is part of the
// STABLE cached prefix and never changes across the conversation. Together with
// the server's always-on tool schemas it exceeds Opus 4.8's minimum cacheable
// prefix on its own — no artificial padding required.
const SYSTEM = `You are a workspace assistant that helps people get real work done across their tools. You are connected to an MCP server over the Model Context Protocol.

# How your tools are organized
A few utilities are always available and appear directly in your tool list: web_search, read_url, send_message, and echo. Reach for these whenever they apply.

Everything else — weather, calendar, CRM, travel, internal knowledge, and more — is organized into capability *groups*. A group's tools are NOT loaded into your context up front. They are disclosed on demand: you open a group, and only then do its tools become callable. This keeps your active toolset small and focused on the task at hand instead of flooding every conversation with capabilities it will never use.

You have two helper tools for working with groups:
- list_groups — returns the groups this server offers, each with a name and a short description of what it is for and when to reach for it.
- get_group — opens a group by name. It returns the group's instructions and makes its scoped tools callable for the rest of the conversation.

# The discovery protocol
When a request needs a specialized capability:
1. If you do not already know which group provides it, call list_groups and read the descriptions.
2. Call get_group for the single most relevant group. Do not speculatively open groups you are not going to use — opening a group has a cost, and a smaller active toolset leads to better tool selection.
3. Once a group is open, call its tools directly, the same way you call any other tool.
4. Follow any instructions the group returned. A group's instructions describe the intended workflow for its tools; treat them as authoritative for that workflow.

Never call a specialized tool before its group has been opened in the current conversation — it will not be available. If a tool call fails because the tool is unknown, open the group that provides it and try again.

# Tool-use discipline
- Prefer doing the work over describing how you would do it. If you have the tools to answer, use them.
- Batch independent tool calls in a single turn when they do not depend on each other (for example, opening two unrelated groups, or making two independent reads).
- When a workflow is sequential (resolve an id, then act on it), do the steps in order and pass real values through — do not guess ids or invent data.
- Only take actions the user asked for. For anything that writes, sends, books, or cancels, confirm the details are correct before acting, and prefer to surface a plan for irreversible actions rather than performing them unprompted.

# Grounding and honesty
- Base every factual claim in a tool result from this conversation. Do not fabricate weather, availability, account details, prices, or confirmations.
- If a tool returns nothing useful or errors, say so plainly rather than papering over it.
- Report outcomes faithfully: what you did, what you found, and anything you could not complete.

# Output
- Lead with the answer the user asked for. Keep it short and scannable; add detail only where it changes what the reader would do next.
- When you have completed a multi-part request, give one concise result per part, in the order asked.
- Do not narrate routine tool calls or restate these instructions back to the user.`;

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));
const serverPath = path.resolve(
  __dirname,
  "../../../groups-server/typescript/dist/index.js"
);

// Client-side helper tools. These, plus the server's top-level tools, form the
// STATIC tool set that never changes across the conversation.
const helperTools = [
  {
    name: "list_groups",
    description:
      "List the capability groups the server offers. Returns each group's name and description.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_group",
    description:
      "Open a group by name. Returns its instructions and reveals (makes callable) the scoped tools it bundles.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The group name to open." },
      },
      required: ["name"],
    },
  },
];

interface TurnUsage {
  turn: number;
  note: string;
  cacheRead: number;
  cacheCreation: number;
  inputUncached: number;
  output: number;
}

// tool_result helper (content block)
function toolResult(id: string, text: string, isError = false) {
  return {
    type: "tool_result",
    tool_use_id: id,
    content: [{ type: "text", text }],
    ...(isError ? { is_error: true } : {}),
  };
}

// Keep exactly one moving cache breakpoint on the latest user turn (plus the
// permanent system-prefix breakpoint), so growing history is cached
// incrementally without exceeding the 4-breakpoint limit.
function moveBreakpoint(messages: any[]) {
  for (const m of messages) {
    if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block && typeof block === "object" && "cache_control" in block) {
          delete block.cache_control;
        }
      }
    }
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && Array.isArray(m.content) && m.content.length) {
      m.content[m.content.length - 1].cache_control = { type: "ephemeral" };
      return;
    }
  }
}

function textFromMcpContent(content: unknown): string {
  if (!Array.isArray(content)) return JSON.stringify(content);
  return content
    .map((c: any) => (typeof c?.text === "string" ? c.text : JSON.stringify(c)))
    .join("\n");
}

async function main() {
  // --- Connect to the demo Groups MCP server over stdio ---
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
  });
  const mcp = new Client(
    { name: "groups-agent", version: "1.0.0" },
    { capabilities: {} }
  );
  await mcp.connect(transport);
  const groups = new GroupsClient(mcp as any);

  // The server's real top-level tools (group-scoped tools are intentionally
  // absent from tools/list — that is the discovery gate the SEP defines).
  const listed = await mcp.listTools();
  const topLevel = listed.tools.map((t: any) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));

  // The static tool set, frozen for the whole run: the server's top-level tools
  // plus the two client-side helpers. Scoped tools are never added here — they
  // are surfaced at the end of the context (see below), so this prefix stays
  // cached.
  const tools: any[] = [...topLevel, ...helperTools];

  // One session id for the whole run; attached to every Vertex request.
  const sessionId = randomUUID();
  // Claude API key → first-party client; otherwise Vertex AI. Both expose the
  // same `beta.messages.create` surface used below.
  let anthropic: any;
  if (USE_API_KEY) {
    anthropic = new Anthropic();
  } else {
    if (!VERTEX_PROJECT) {
      throw new Error(
        "ANTHROPIC_VERTEX_PROJECT_ID is required for the Vertex AI provider " +
          "(or set ANTHROPIC_API_KEY to use the Claude API)."
      );
    }
    anthropic = new AnthropicVertex({
      projectId: VERTEX_PROJECT,
      region: VERTEX_REGION,
      defaultHeaders: { "X-Vertex-Ai-Session-Id": sessionId },
    });
  }

  // System prompt as a content-block array with a permanent cache breakpoint —
  // this caches `tools` + `system` together (the stable prefix).
  const system = [
    { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
  ];

  const messages: any[] = [
    { role: "user", content: [{ type: "text", text: TASK }] },
  ];

  // Scoped tools become callable only after their group is opened.
  const scopedTools = new Set<string>();

  const usageLog: TurnUsage[] = [];
  let turn = 0;

  console.log(`\n=== Groups agent ===`);
  if (USE_API_KEY) {
    console.log(`Claude API: model=${MODEL}`);
  } else {
    console.log(
      `Vertex AI: project=${VERTEX_PROJECT} region=${VERTEX_REGION} model=${MODEL}`
    );
    console.log(`X-Vertex-Ai-Session-Id: ${sessionId}`);
  }
  console.log(`Static tools (stable prefix): ${tools.map((t: any) => t.name).join(", ")}`);
  console.log(`Task: ${TASK}\n`);

  while (true) {
    turn++;
    moveBreakpoint(messages);

    const params: any = {
      model: MODEL,
      max_tokens: 2048,
      betas: [BETA],
      thinking: { type: "adaptive" },
      system,
      tools,
      messages,
    };

    const resp: any = await anthropic.beta.messages.create(params);

    const u = resp.usage ?? {};
    const surfaced =
      turn === 1
        ? "initial request"
        : "follow-up";
    usageLog.push({
      turn,
      note: surfaced,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheCreation: u.cache_creation_input_tokens ?? 0,
      inputUncached: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
    });

    messages.push({ role: "assistant", content: resp.content });

    // Print any assistant text.
    for (const block of resp.content) {
      if (block.type === "text" && block.text.trim()) {
        console.log(`[assistant] ${block.text.trim()}`);
      }
    }

    if (resp.stop_reason !== "tool_use") break;

    const toolResults: any[] = [];
    const additions: any[] = [];

    for (const block of resp.content) {
      if (block.type !== "tool_use") continue;
      const { name, id } = block;
      const input: any = block.input ?? {};
      console.log(`  → tool_use: ${name}(${JSON.stringify(input)})`);

      if (name === "echo") {
        const r = await mcp.callTool({ name, arguments: input });
        toolResults.push(toolResult(id, textFromMcpContent(r.content)));
      } else if (name === "list_groups") {
        const r = await groups.listGroups();
        const summary = r.groups
          .map((g) => `- ${g.name}: ${g.description}`)
          .join("\n");
        toolResults.push(toolResult(id, `Available groups:\n${summary}`));
      } else if (name === "get_group") {
        const g = await groups.getGroup(input.name);
        const scoped = g.contents?.tools ?? [];
        for (const t of scoped) {
          scopedTools.add(t.name);
          const def = {
            name: t.name,
            description: t.description ?? "",
            input_schema: t.inputSchema,
          };
          // Cache-safe: surface at the end of the context via tool_addition.
          additions.push({
            type: "tool_addition",
            tool: { type: "tool_definition", definition: def },
          });
        }
        const toolNames = scoped.map((t) => t.name).join(", ") || "(none)";
        const summary =
          `Opened group '${input.name}'.\n` +
          `Instructions: ${g.instructions ?? "(none)"}\n` +
          `Tools now available: ${toolNames}`;
        toolResults.push(toolResult(id, summary));
        usageLog[usageLog.length - 1].note += ` · opened '${input.name}'`;
      } else if (scopedTools.has(name)) {
        const r = await mcp.callTool({ name, arguments: input });
        toolResults.push(toolResult(id, textFromMcpContent(r.content)));
      } else {
        toolResults.push(
          toolResult(
            id,
            `Tool '${name}' is not available yet. Open its group with get_group first.`,
            true
          )
        );
      }
    }

    messages.push({ role: "user", content: toolResults });

    // Cache-safe disclosure: append the scoped tool definitions as a
    // mid-conversation system message, AFTER the moving cache breakpoint.
    if (additions.length) {
      messages.push({
        role: "system",
        content: [
          ...additions,
          {
            type: "text",
            text: "The tools above are now available for this workflow.",
          },
        ],
      });
    }
  }

  printReport(usageLog);
  await mcp.close();
  process.exit(0);
}

function printReport(log: TurnUsage[]) {
  console.log(`\n=== Prompt-cache report ===`);
  console.log(
    "turn | cache_read | cache_write | input(uncached) | output | note"
  );
  console.log(
    "-----+------------+-------------+-----------------+--------+-----"
  );
  let totalRead = 0;
  let totalWrite = 0;
  for (const t of log) {
    totalRead += t.cacheRead;
    totalWrite += t.cacheCreation;
    console.log(
      `${String(t.turn).padStart(4)} | ${String(t.cacheRead).padStart(10)} | ${String(
        t.cacheCreation
      ).padStart(11)} | ${String(t.inputUncached).padStart(15)} | ${String(
        t.output
      ).padStart(6)} | ${t.note}`
    );
  }
  console.log(
    "-----+------------+-------------+-----------------+--------+-----"
  );
  console.log(
    `totals: cache_read=${totalRead}  cache_write=${totalWrite}`
  );
}

main().catch((e) => {
  const msg = String(e?.message ?? e).toLowerCase();
  if (
    msg.includes("credential") ||
    msg.includes("authentication") ||
    msg.includes("could not load the default") ||
    msg.includes("permission")
  ) {
    console.error(
      USE_API_KEY
        ? "\nSet ANTHROPIC_API_KEY to a valid Claude API key.\n"
        : "\nThis agent is using Claude on Vertex AI with Google Application " +
            "Default Credentials. Run `gcloud auth application-default login` and " +
            `ensure the account has Vertex access to project '${VERTEX_PROJECT}'.\n`
    );
  }
  console.error(e);
  process.exit(1);
});
