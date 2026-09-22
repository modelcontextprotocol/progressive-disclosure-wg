// Test-only SDK bridge. Its private fixture file is not a production configuration API.
import { readFile } from 'node:fs/promises';
import { Server as MCPServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { Server } from '../../../../experiments/deterministic-groups/reference.mjs';

const path = process.argv[2];
let state = JSON.parse(await readFile(path, 'utf8'));
const model = new Server(state.fixture, state.options);
const session = { allowed: new Set(state.allowed) };
const capabilities = model.dispatch(session, 'initialize', {}).capabilities;
// SDK 1.27.1 strips the draft tools.manifest field on the client. Negotiate
// this bridge explicitly through experimental metadata, never infer support.
if (model.grouping) capabilities.experimental['experimental/deterministic-groups'].manifest = true;
capabilities.tools.listChanged = true;
const server = new MCPServer({ name: 'grouping-test-bridge', version: '0.0.1' }, { capabilities });
let initialized = false;
server.oninitialized = () => {
    initialized = true;
};

async function refresh() {
    const next = JSON.parse(await readFile(path, 'utf8'));
    const previous = model.view(session).revision;
    model.data = next.fixture;
    session.allowed = new Set(next.allowed);
    state = next;
    if (initialized && previous !== model.view(session).revision) await server.sendToolListChanged();
}
const methods = ['ping', 'tools/list', 'tools/call'];
if (model.manifest) methods.push('tools/manifest', 'tools/describe');
if (model.grouping) methods.push('experimental/groups/list', 'experimental/groups/expand');
for (const method of methods) {
    server.setRequestHandler(z.object({ method: z.literal(method), params: z.record(z.unknown()).optional() }), async request => {
        await refresh();
        if (method === 'ping') return {};
        const response = model.request(session, { jsonrpc: '2.0', id: 1, ...request });
        if (response.error) throw new McpError(response.error.code, response.error.message, response.error.data);
        return response.result;
    });
}
await server.connect(new StdioServerTransport());
