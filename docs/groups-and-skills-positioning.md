# Positioning: Groups and Skills over MCP

This doc lays out how the Groups proposal
([SEP draft](../seps/0000-progressive-disclosure-groups.md)) fits with Skills
over MCP ([Skills extension][skills-ext]), so the working group and the Skills
over MCP contributors can align on a single framing. It walks through three
options and their tradeoffs, shows a few examples of what Option 2 looks like
on the wire, and lists the interop rules we'd need, to gather feedback before
we commit to one in the SEP.

> **Status:** Draft for WG feedback. Option 2 received the most votes in the
> initial WG discussion, but Option 3 remains a competitive alternative.

## Background

Groups borrows its core design from Agent Skills, re-expressed in terms of MCP
primitives rather than markdown files.

Agent Skills proved out the core progressive disclosure pattern: expose only a
lightweight `name` and `description` up front, and load the full instructions
and supporting material on demand. Both efforts bring that pattern to MCP, at
different layers:
- **Skills over MCP** transports the existing Agent Skills format (`SKILL.md`
  and supporting files) over MCP using `skill://` resources. Its goal is to
  carry filesystem-based skills over MCP as-is, without introducing a new
  protocol primitive.
- **Groups** applies the same progressive disclosure model directly to MCP
  primitives. A group lists only a `name` and `description` in `group/list`;
  calling `group/get` returns the scoped tools, prompts, resources, and nested
  groups it contains, along with optional `instructions`.

Skills over MCP is scoped to serving markdown and files as resources. It
deliberately does not disclose executable MCP primitives (a skill on disk can't
carry a tool schema either), and groups can serve workflows that need them:

1. **Disclose tools and prompts on demand.** A `SKILL.md` resource is read-only
   text. It can mention tool names, but it cannot carry a tool's input
   schema or make a hidden tool callable. Groups keeps situational tools and
   prompts out of top-level `tools/list` and `prompts/list` and delivers their
   typed, invokable definitions only when the client calls `group/get`.
2. **Ship instructions and the tools they run as one unit.** With Skills alone,
   a client can load a skill only to find that the tools it references are
   missing from `tools/list`. A group returns the workflow's `instructions` and
   the typed definitions of the tools, prompts, and resources it uses in a
   single round-trip.
3. **Organize plain toolsets and nested hierarchies.** Not every bundle is a
   skill. A server can use a group to collapse 20 calendar tools behind one
   entry, split tools by read/write/admin scope, or nest sub-groups, without
   writing workflow prose or forcing a tool catalog into a `SKILL.md` layout.

| Capability | Skills over MCP | Groups |
| :--- | :--- | :--- |
| Progressive disclosure of instructions (`SKILL.md` / prose) | Yes (via `skill://` resources) | Yes (via optional `instructions` or scoped resources) |
| Progressive disclosure of typed tools and prompts | No (can only name tools in text) | Yes (returned on `group/get`, omitted from `*/list`) |
| Guarantees referenced tools are present and callable | No | Yes |
| Plain toolsets or resource bundles (no workflow prose) | No | Yes |
| Nested hierarchy | Partial: skills can nest by directory, and the listing stays flat | Yes |
| Zero-conversion transport for existing `SKILL.md` folders | Yes | Requires mapping to a group |
| Same artifact works from disk without MCP | Yes | No |
| Workflows spanning several servers | Yes | One server, unless a proxy combines them |
| Per-file digests and content-bound approval | Yes | Not in the current draft |

Both mechanisms expose a small entrypoint that expands on demand, and both can
carry task guidance. The open question is how the two specs should relate to
each other.

## Options

Each option comes with a short sketch, using the same `refunds` workflow.

### Option 1: Competing standards

**Framing:** Groups and Skills over MCP are treated as two separate solutions to
the same problem. They are specified independently, and a server author picks
one or the other. Neither spec references or interoperates with the other.

**In practice:** A server is either a "Skills server" or a "Groups server".

```
// Option A: Skills server (SEP-2640)
skills/list -> skill://refunds/SKILL.md
tools/list  -> [all tools up front]

// Option B: Groups server
groups/list -> [{ name: "refunds", ... }]
groups/get  -> { instructions, tools, ... }

// Specs evolve separately; no interop
```

The Skills server can load the refund instructions on demand, but all its tools
are still in `tools/list` up front. The Groups server loads the tools on demand,
but its instructions are not an Agent Skill.

**Implications:**

- The ecosystem carries overlapping discovery mechanisms with similar goals;
  clients and server authors must learn both and pick between them.
- The WG would need to publish "when to use which" guidance, and keep it current
  as the two specs diverge.
- Composition is not a goal: a skill and a group are not expected to reference
  each other.

**Pros**

- Each spec stays simple and focused: Skills on the Agent Skills format, Groups
  on MCP primitives.
- No coordination needed across working groups.

**Cons**

- Locks in three overlapping ways to package capabilities (local Skills, Skills
  over MCP, and Groups).
- Clients have to build both extensions, plus `resources/read` for skill files.
- Confusing for authors, especially when a workflow needs both instructions and
  tools, which slows adoption of both specs.

### Option 2: Complementary standards

**Framing:** Groups and Skills over MCP solve adjacent parts of the problem and
are designed to compose. Skills carry portable markdown (the Agent Skills
format, served as resources). Groups disclose MCP primitives (tools, prompts,
resources, and nested groups), and a group can list a skill as one of its
resources. A skill can still be used on its own.

**In practice:** A group lists the skill's `SKILL.md` as a normal resource next
to the tools that run it. No new field needed.

```
// A Group lists the Skill as an ordinary resource, next to its primitives
groups/get { name: "refunds" } -> {
  resources: [
    { uri: "skill://refunds/SKILL.md", mimeType: "text/markdown" }
  ],
  tools: [lookup_order, issue_refund],
  prompts: [refund_summary]
}
```

The skill is still a skill: the host confirms it with `skills/get`, checks the
digests and applies any approval before loading it. The group only makes it
easy to find next to the tools; it doesn't grant approval.

So a plain skill stays a plain skill, a plain toolset becomes a group, and a
workflow that needs both becomes a group that scopes the tools and lists the
skill. There's an example of each [below](#what-option-2-looks-like-in-practice).

**Implications:**

- Groups becomes the way MCP discloses primitives, and Skills over MCP stays the
  binding for Agent Skills. The two specs evolve separately, with a few clear
  interop points (see [Interop rules](#interop-rules)).
- Existing Skills over MCP implementations keep working as they are.

**Pros**

- Doesn't break existing SEP-2640 servers.
- Pairs one skill format (with digests and approval) with live, typed tools
  scoped to the caller.
- Keeps a single definition of "skill" instead of inventing an MCP-only variant.

**Cons**

- The ecosystem and clients still carry all three mechanisms.
- Skills over MCP still need URIs and `resources/read`; agents can't grep or run
  shell commands on them like they can with local skills.
- Server authors still need to choose between a skill, a group, or both.

### Option 3: Evolving standard (rename Groups → Skills)

**Framing:** Rename Groups to Skills, as a "Skills v2" over MCP. A skill over MCP
becomes instructions plus the typed primitives it uses, so code-defined skills
and `SKILL.md` folders live under one extension.

**In practice:** Server authors define skills in code (similar to a FastAPI
`APIRouter`), or load an existing folder.

```python
# Code skill (FastAPI / APIRouter style)
refunds = Skill(
    "refunds", instructions="Verify order..."
)

@refunds.tool()
def issue_refund(id: str) -> Receipt: ...

mcp.include_skill(refunds)

# Or load a SKILL.md folder in one line
mcp.include_skill(Skill.from_dir("./policy"))
```

On the wire it's `skills/list` and `skills/get` (today's `groups/list` and
`groups/get`, renamed), and the SDK maps a `SKILL.md` folder to instructions plus
resources.

**Implications:**

- Clients and servers only have one progressive disclosure extension to learn
  and implement.
- The mapping from Agent Skills on disk to Skills v2 on the wire becomes a
  long-term compatibility contract the WG has to maintain.
- Existing Skills over MCP (SEP-2640) adopters have to migrate.

**Pros**

- Cuts three models down to two: skills on disk, and Skills over MCP.
- One MCP extension and one mental model to build and learn.
- Code-defined skills fit well for servers that already organize tools by
  router or module.

**Cons**

- Not compliant with the Agent Skills spec: an MCP skill would carry typed tools
  that a `SKILL.md` can't, so the two definitions of "skill" drift apart.
- Breaking change for early SEP-2640 adopters.
- Reverses a core goal of Skills over MCP (no new protocol primitive), and we'd
  need to carry over what that extension already does for skills, like digests,
  approval, and relative paths.

### Summary

| | Option 1: Competing | Option 2: Complementary | Option 3: Evolving (rename) |
| :--- | :--- | :--- | :--- |
| Wire methods | `skills/*` or `groups/*` | `skills/*` and `groups/*` | `skills/*` only |
| Models in the ecosystem | Three, no interop | Three, with interop | Two |
| Definition of "skill" | One (Agent Skills) | One (Agent Skills) | Two, drifting apart |
| Impact on shipped Skills over MCP | None | None | Breaking change |
| Workflow with instructions + tools | Unclear which to use | Group lists the skill | One code-defined skill |
| Cross-spec coordination | None | A few interop points | Ongoing mapping contract |

## Current lean

Option 2. Skills are already well established and defined outside MCP, and the
Skills extension is a transport for that format. Changing what a skill is over
MCP (Option 3) would leave two definitions of the same concept that drift apart,
which I think is more confusing than two mechanisms with a clear boundary.
Option 1 avoids that, but doesn't give a clear answer for the most common case:
instructions plus the tools they need.

## What Option 2 looks like in practice

A rough rule of thumb:

| If it's… | Use | Example |
| :--- | :--- | :--- |
| Knowledge or instructions that should stay portable | A skill | [Example 1](#example-1-a-skill-as-is) |
| Typed tools from one server, no workflow worth writing down | A group | [Example 2](#example-2-a-tool-only-group) |
| A workflow that needs both | A group that lists the skill | [Example 3](#example-3-a-group-that-lists-a-skill-and-its-tools) |

All three use the same hypothetical `acme-support` server, which supports both
extensions. JSON is trimmed (`…`).

### Example 1: A skill as-is

A style guide for customer messages is just knowledge. It needs no tools, and
the team also uses it from disk in other agents, so it stays a plain skill.
Groups isn't involved.

```
skill://acme/support/customer-tone/
├── SKILL.md
└── examples/apology-email.md
```

`skills/list` returns it as usual:

```json
{
  "skills": [
    {
      "uri": "skill://acme/support/customer-tone/SKILL.md",
      "frontmatter": {
        "name": "customer-tone",
        "description": "Write customer-facing messages in Acme's support voice"
      },
      "resources": [
        { "uri": "skill://acme/support/customer-tone/SKILL.md", "digest": "sha256:…", "size": 812 },
        { "uri": "skill://acme/support/customer-tone/examples/apology-email.md", "digest": "sha256:…", "size": 406 }
      ]
    }
  ],
  "ttlMs": 300000,
  "cacheScope": "public"
}
```

The host loads it through its normal skill path when the model needs it. Nothing
here changes because Groups exists.

### Example 2: A tool-only group

The same server has 20 calendar tools. There's no workflow worth writing down,
so they become a plain group with no `instructions` and no skill.

`groups/list` returns one entry:

```json
{
  "groups": [
    {
      "name": "calendar",
      "title": "Calendar",
      "description": "Use to read or change support agents' schedules and customer callbacks."
    }
  ],
  "ttlMs": 600000,
  "cacheScope": "public"
}
```

`groups/get {"name": "calendar"}` returns the tools:

```json
{
  "tools": [
    { "name": "list_events",  "description": "List events in a date range.", "inputSchema": { … } },
    { "name": "create_event", "description": "Create an event.",             "inputSchema": { … } },
    { "name": "move_event",   "description": "Move an event to a new time.", "inputSchema": { … } }
  ],
  "ttlMs": 600000,
  "cacheScope": "private"
}
```

Until the model needs the calendar, it only pays for one name and description.
After `groups/get`, the client registers the tools and calls them with a normal
`tools/call`. A client that doesn't support Groups just sees the tools in
`tools/list`.

### Example 3: A group that lists a skill and its tools

Refunds need both. The team maintains the refund procedure and policy as an
Agent Skill, and the actions (`lookup_order`, `issue_refund`) are server tools
that shouldn't be in every session. So the server keeps the skill as is, and
adds a group with the tools plus the skill.

The skill, same as on disk:

```
skill://acme/billing/refunds/
├── SKILL.md
└── references/policy.md
```

```markdown
---
name: refunds
description: Process customer refund requests per Acme policy
---
1. Confirm the charge with `lookup_order`.
2. Check eligibility against [the policy](references/policy.md).
3. Issue the refund with `issue_refund`, then tell the customer.
```

`groups/list` includes:

```json
{ "name": "refunds", "description": "Use for refund or duplicate-charge requests on customer orders." }
```

`groups/get {"name": "refunds"}` returns the tools and the skill:

```json
{
  "instructions": "Follow the refunds skill for procedure and policy. lookup_order is read-only; issue_refund moves money, so confirm the amount with the user first.",
  "tools": [
    { "name": "lookup_order", "description": "Fetch an order and its charges.", "inputSchema": { … } },
    { "name": "issue_refund", "description": "Refund a charge on an order.",    "inputSchema": { … } }
  ],
  "resources": [
    {
      "uri": "skill://acme/billing/refunds/SKILL.md",
      "name": "refunds",
      "mimeType": "text/markdown",
      "description": "Process customer refund requests per Acme policy"
    }
  ],
  "ttlMs": 300000,
  "cacheScope": "private"
}
```

The group only lists the `SKILL.md`; the rest of the skill's files come from its
Skills entry and are read when needed. The `instructions` here are about the
group's own tools, not a copy of the skill.

From the host's side:

1. At session start, the model sees `refunds` and `calendar` as names and
   descriptions.
2. The model picks `refunds`. The client calls `groups/get`, registers the two
   tools, and shows the group instructions.
3. The client sees the `SKILL.md` resource and confirms it with `skills/get`,
   which returns the file list and digests.
4. The host loads the skill through its normal skill path (verify, approve if
   needed, read). The group doesn't grant approval.
5. When the model follows `references/policy.md`, the host resolves it against
   the skill root and checks it against the entry.
6. The model calls `lookup_order`, then `issue_refund`.

What's guaranteed: `lookup_order` and `issue_refund` are there and callable,
because the group returned them. Text isn't, whether it's the group
`instructions` or the `SKILL.md`. If a read-only caller doesn't get
`issue_refund`, the server should build that caller's `instructions` from what it
actually returned. The `SKILL.md` is a static file and still mentions
`issue_refund`, so the server can point to a different skill for that caller, or
say in `instructions` that the step isn't available.

For clients that only support one of the extensions:

| Client supports | What it sees |
| :--- | :--- |
| Groups and Skills | Everything above |
| Groups only | The tools and instructions; the `SKILL.md` is just a resource it can read |
| Skills only | The tools flattened into `tools/list`; the skill via `skills/list` if listed |
| Neither | The tools in `tools/list`; skill files as plain resources if listed |

### Group instructions without a skill

A server can also put workflow text straight into a group's `instructions`
without any skill. That's fine, but it's group guidance, not a skill: there's no
`skills/list` entry, no digests, no approval, and no skill root for relative
paths. If you want any of that, or want the guidance to be portable, write a
skill and list it from the group like in Example 3.

## Interop rules

For Option 2, both specs would need to agree on a few things:

1. **A listed skill is still a skill.** It's identified, verified, and activated
   through the Skills extension, the same as from any other reference.
2. **Listing isn't approval.** A group makes a skill easy to find; it doesn't
   approve it.
3. **Groups are a valid referrer.** The Skills extension lists three sources of
   skill references (server `instructions`, another skill, or the user). We'd add
   a group's `resources` as a fourth, confirmed with `skills/get`.
4. **Reference by URI, not scheme.** The scheme doesn't identify a skill, and
   servers can use schemes other than `skill://`.
5. **Only returned primitives are guaranteed.** Whatever `groups/get` returns is
   there and callable for that caller. Tools mentioned in text (`instructions` or
   a skill) aren't guaranteed by that alone.
6. **Keep instructions consistent.** If a server varies a group's contents by
   caller, it SHOULD keep that caller's `instructions` consistent with what it
   returned.
7. **Instructions describe the group.** `instructions` explain how to use the
   group's own contents. The SEP shouldn't describe them as "what a `SKILL.md`
   would carry", since that makes the two sound interchangeable.

## References

- [Progressive Disclosure discussion](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/3458)
- [Groups SEP draft (#19)](https://github.com/modelcontextprotocol/progressive-disclosure-wg/pull/19)
- [Skills extension specification][skills-ext]
- [Agent Skills specification](https://agentskills.io/specification)

[skills-ext]: https://github.com/modelcontextprotocol/ext-skills/blob/main/specification/beta/skills.mdx
