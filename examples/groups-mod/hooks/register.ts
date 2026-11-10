import type { On } from 'claude-code'

/**
 * groups-mod — a deliberately "hacky" proof that Claude Code can work with a
 * Groups-SEP server WITHOUT any changes to the Claude Code core.
 *
 * The server is any stdio MCP server that implements the Groups SEP: it answers
 * `groups/list` and `groups/get`, serves scoped tools through `tools/call`, and
 * keeps those scoped tools OUT of `tools/list` (discovery gating). This mod is
 * server-agnostic — it hardcodes nothing about the groups or their tools, and
 * returns no canned results. Everything comes from the real server.
 *
 * Why drive the server ourselves instead of using $.mcp.call: a mod's $.mcp.call
 * is restricted to tools that appear in the server's tools/list (the engine
 * resolves it against its connected-tool registry). A SEP server hides its scoped
 * tools and exposes custom JSON-RPC methods (groups/list, groups/get), so
 * $.mcp.call can reach NONE of them. $.process.run is ungated, so the mod speaks
 * JSON-RPC to the server directly over stdio. The SEP is a stateless pull
 * protocol, so one short-lived server process per request is fine.
 *
 * Flow:
 *  - session.start : register list_groups + open_group.
 *  - list_groups   -> groups/list, returned verbatim.
 *  - open_group    -> groups/get, then $.tool.register each real scoped tool,
 *                     marked deferred so mid-session disclosure stays cache-safe.
 *  - scoped call   -> tools/call, result returned verbatim.
 */

const PLUGIN = 'groups'

// How to launch the SEP server. ANY stdio MCP server implementing the Groups SEP
// works here — only this command changes. (A real plugin would take this from
// userConfig/env; hardcoded for the prototype.)
const SERVER_ARGV = [
    'node',
    '/Users/whaoyu/git/experimental-ext-grouping/examples/groups-server/typescript/dist/index.js',
]

const prefix = `mcp__${PLUGIN}__`
const short = (full: string) =>
    full.startsWith(prefix) ? full.slice(prefix.length) : full

// scoped tool name -> group it belongs to (populated as groups are opened)
const scopedToGroup = new Map<string, string>()
// scoped tool name -> its description (for a stable tool.describe answer)
const scopedDesc = new Map<string, string>()

// A plugin tool's result is the value the model reads; core wraps a plain string
// into the tool_result.
function ok(t: string) {
    return { result: t }
}

// --- Minimal stdio JSON-RPC client over $.process.run ----------------------
// Feed initialize + initialized + one request, close stdin (EOF); the server
// answers on stdout and exits. Parse the response whose id matches.
let rpcSeq = 100
async function rpc(
    $: any,
    method: string,
    params?: Record<string, unknown>,
): Promise<any> {
    const id = ++rpcSeq
    const stdin =
        [
            JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2024-11-05',
                    capabilities: {},
                    clientInfo: { name: 'groups-mod', version: '0' },
                },
            }),
            JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
            JSON.stringify({
                jsonrpc: '2.0',
                id,
                method,
                ...(params ? { params } : {}),
            }),
        ].join('\n') + '\n'

    const res = await $.process.run(SERVER_ARGV, { stdin })
    for (const line of String(res?.stdout ?? '').split('\n')) {
        if (!line.trim()) continue
        let msg: any
        try {
            msg = JSON.parse(line)
        } catch {
            continue
        }
        if (msg.id === id) {
            if (msg.error) throw new Error(msg.error.message ?? 'rpc error')
            return msg.result
        }
    }
    throw new Error(`no response for ${method} (exit ${res?.exitCode})`)
}

// Build the "capability groups" prompt section from the server's live groups/list:
// the model learns which groups exist and what each is for, so it can open the
// right one instead of guessing. Server-driven — nothing about the groups is
// hardcoded. Returns null if the server advertises no groups (then inject nothing).
async function groupsSection($: any): Promise<string | null> {
    let groups: any[]
    try {
        const r = await rpc($, 'groups/list')
        groups = r?.groups ?? []
    } catch {
        return null
    }
    if (!groups.length) return null
    const lines = groups
        .map((g) => `- ${g.name}: ${g.description ?? g.title ?? ''}`.trimEnd())
        .join('\n')
    return [
        'This session exposes capability "groups". Specialized tools are not loaded',
        'up front — each group bundles related tools that become callable only after',
        'you open the group. When a task matches a group below, call open_group with',
        'its name first to reveal its tools, then use them. Call list_groups to',
        're-list at any time.',
        '',
        'Available groups:',
        lines,
    ].join('\n')
}

export function register(on: On) {
    on('session.start', async ($, e, next) => {
        await $.tool.register({
            name: 'list_groups',
            description:
                'List the capability groups this server offers (name + description). Call this to discover what workflows are available before using a specialized tool.',
            inputSchema: { type: 'object' },
        })
        await $.tool.register({
            name: 'open_group',
            description:
                'Open a capability group by name. Reveals and makes callable the scoped tools it bundles. Always open the relevant group before calling a specialized tool.',
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'The group name to open.' },
                },
                required: ['name'],
            },
        })
        return next(e)
    })

    // Inject a "capability groups" section into the model's prompt once per
    // conversation, built live from the server's groups/list. The model sees which
    // groups exist and what each is for from the first turn, so it opens the right
    // group instead of answering blind or reaching for web search.
    on('prompt.context', async ($, e, next) => {
        const text = await groupsSection($)
        if (!text) return next(e)
        const blocks = [...e.blocks, { name: 'capability-groups', text }]
        return next({ ...e, blocks })
    })

    on('tool.call', async ($, e, next) => {
        const name = short(e.tool)
        // A tool's own arguments are spread onto the event beside the reserved
        // keys (`tool`, `tool_use_id`).
        const args = e as unknown as Record<string, unknown>

        if (name === 'list_groups') {
            try {
                const r = await rpc($, 'groups/list')
                const groups: any[] = r?.groups ?? []
                if (!groups.length) return ok('No capability groups available.')
                const list = groups
                    .map((g) => `- ${g.name}: ${g.description ?? g.title ?? ''}`)
                    .join('\n')
                return ok(`Available groups:\n${list}`)
            } catch (err) {
                return { deny: `list_groups failed: ${String(err)}` }
            }
        }

        if (name === 'open_group') {
            const g = String(args.name ?? '')
            if (!g) return { deny: 'open_group requires a group name.' }
            let r: any
            try {
                r = await rpc($, 'groups/get', { name: g })
            } catch (err) {
                return { deny: `open_group '${g}' failed: ${String(err)}` }
            }
            const tools: any[] = r?.contents?.tools ?? []
            // Disclose the group's scoped tools mid-session. Populate the lookup
            // maps BEFORE $.tool.register: the engine may fire tool.describe during
            // registration, and if the maps aren't set yet it would land the tool
            // in the resident prompt (busting cache) instead of deferred.
            for (const t of tools) {
                const isNew = !scopedToGroup.has(t.name)
                scopedToGroup.set(t.name, g)
                scopedDesc.set(t.name, t.description ?? '')
                if (isNew) {
                    await $.tool.register({
                        name: t.name,
                        description: t.description ?? '',
                        inputSchema: t.inputSchema ?? { type: 'object' },
                    })
                }
            }
            const names = tools.map((t) => t.name).join(', ') || '(none)'
            const instr = r?.instructions ? `\nInstructions: ${r.instructions}` : ''
            return ok(`Opened '${g}'.${instr}\nTools now available: ${names}`)
        }

        if (scopedToGroup.has(name)) {
            // Execute the scoped tool on the real server via tools/call. The tool is
            // hidden from tools/list, so only this direct JSON-RPC channel reaches it.
            const { tool: _t, tool_use_id: _u, ...callArgs } = args
            try {
                const r = await rpc($, 'tools/call', {
                    name,
                    arguments: callArgs,
                })
                const out = (r?.content ?? [])
                    .map((c: any) => (c?.type === 'text' ? c.text : JSON.stringify(c)))
                    .join('\n')
                return r?.isError ? { deny: out || `${name} failed` } : ok(out)
            } catch (err) {
                return { deny: `${name} failed: ${String(err)}` }
            }
        }

        return next(e)
    })

    // Mark disclosed scoped tools DEFERRED so mid-session registration is
    // cache-safe: a resident tool added mid-session rewrites the prompt prefix,
    // while a deferred one is surfaced without busting the cached prefix.
    on('tool.describe', (_$, e, next) => {
        const n = short(String((e as any).tool ?? ''))
        if (scopedToGroup.has(n)) {
            return { description: scopedDesc.get(n) ?? '', isDeferred: true }
        }
        return next(e)
    })
}
