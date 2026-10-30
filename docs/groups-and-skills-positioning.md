# Positioning: Groups and Skills over MCP

This doc lays out how the Groups proposal (progressive disclosure of MCP
primitives) fits with Skills over MCP, so the working group and the Skills over
MCP contributors can align on a single framing. It walks through three options
and their tradeoffs to gather feedback before we commit to one in the SEP.

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

Because Skills over MCP is scoped to serving markdown and files as resources, it
leaves gaps whenever a workflow depends on executable MCP primitives:

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
| Nested hierarchy (`group` inside `group`) | No | Yes |
| Zero-conversion transport for existing `SKILL.md` folders | Yes | Requires mapping to a group |

Both mechanisms expose a small entrypoint that expands on demand, and both can
carry task guidance. The open question is how the two specs should relate to
each other.

## Option 1: Competing standards

**Framing:** Groups and Skills over MCP are treated as two separate solutions to
the same problem. They are specified independently, and a server author picks
one or the other. Neither spec references or interoperates with the other.

**In practice:** A server that wants progressive disclosure decides whether it
is a "Skills server" or a "Groups server." The two specs evolve on separate
tracks, and clients likely end up supporting both to work across the ecosystem.

**Implications:**

- The ecosystem carries two overlapping discovery mechanisms with similar goals;
  clients and server authors must learn both and pick between them.
- The WG would need to publish "when to use which" guidance, and keep it current as
  the two specs diverge.
- Composition is not a goal: a skill and a group are not expected to nest or
  reference each other.

**Pros**

- Lets each spec optimize for its own use case: Skills stays faithful to the
  Agent Skills file format, and Groups stays focused on MCP primitives.
- Clean ownership, with no cross-spec coordination required.

**Cons**

- Fragments the ecosystem. Having two ways to do progressive disclosure causes
  confusion and duplicates client implementation work.
- The boundary between them is blurry whenever a workflow involves both
  instructions and tools, making "when to use which" guidance hard to write.

## Option 2: Complementary standards

**Framing:** Groups and Skills over MCP solve adjacent parts of the problem and
are designed to compose. Skills over MCP is the transport binding for the Agent
Skills format (portable markdown instructions and files). Groups is the
MCP-native way to bundle and disclose protocol primitives (tools, prompts,
resources, and nested groups). A group can reference or inline a skill, and a
skill can still be used on its own.

**In practice:** A server exposes skills as defined by the Skills over MCP spec.
When a workflow also needs to disclose the tools or prompts that execute it, a
group bundles them together: the group scopes the relevant tools and either
includes the skill as a `skill://` resource or puts the workflow directly in
the group's `instructions` field. Standalone skills that don't need scoped
tools stay plain skills; toolsets that don't need a `SKILL.md` stay plain
groups.

**Implications:**

- Groups is positioned as MCP's primitive disclosure mechanism; Skills over MCP
  remains the binding for Agent Skills. The two specs evolve separately but
  define clear interop points.
- Existing Skills over MCP implementations keep working without changes.
- The WG needs to specify how composition works in practice (how a group
  references a `skill://` resource, and how a skill's content relates to a
  group's `instructions`).

**Pros**

- Matches how the two actually differ: file-based skills and typed MCP
  primitives operate at different layers, and combining them covers cases
  neither handles as cleanly alone.
- Non-disruptive to Skills over MCP, which has already shipped and is being
  adopted.
- Keeps a single definition of "skill" (the Agent Skills spec) instead of
  inventing an MCP-only variant.

**Cons**

- Server authors still have to choose whether to model a capability as a bare
  skill, a group, or a group wrapping a skill, which requires clear guidance.
- Clients that want full ecosystem coverage still implement both extensions.

## Option 3: Replacement or evolution

**Framing:** Groups becomes the successor to Skills over MCP. Instead of a
separate resource convention, a skill over MCP is just a group that carries
`instructions` alongside its scoped primitives. Skills over MCP is folded into
or deprecated in favor of Groups.

**In practice:** A server publishing a skill over MCP exposes it as a group. We
define a standard mapping from the Agent Skills format onto a group, and
existing Skills over MCP implementations migrate over time. Over the wire, a
skill is represented as a group with instructions.

**Implications:**
- Clients and servers only have one progressive disclosure extension to learn
  and implement.
- The mapping from Agent Skills on disk to Groups on the wire becomes a
  long-term compatibility contract the WG has to maintain.
- Existing Skills over MCP adopters face a migration cost.

**Pros**
- Simplest end state on the protocol side: one MCP-native mechanism for
  progressive disclosure instead of two.
- Avoids coordinating two overlapping specs long-term.
- One mental model for MCP client and server authors.

**Cons**
- Reverses a core design goal of Skills over MCP, which was to carry the Agent
  Skills format without introducing a new protocol primitive.
- Splits the definition of a skill: an MCP skill (modeled as a group) would
  inevitably drift from a filesystem Agent Skill as both specs evolve, forcing
  authors and tooling to reconcile two versions of the same concept.
- Collapsing file-based skills into MCP primitives risks losing filesystem
  conventions that existing skills rely on.
- Disruptive to a spec that was just released and is already being implemented.

## References
- [Progressive Disclosure discussion](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/3458)
