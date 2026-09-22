import { mkdtemp, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ResultSchema, ToolListChangedNotificationSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { canonical } from '../../../../experiments/deterministic-groups/reference.mjs';

export const serialize = canonical;
export async function createAdapter({ fixture, allowed, options = {} }) {
    const directory = await mkdtemp(join(tmpdir(), 'grouping-sdk-'));
    const path = join(directory, 'fixture.json');
    const state = { fixture, allowed, options };
    await writeFile(path, JSON.stringify(state), { mode: 0o600 });
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [fileURLToPath(new URL('./server.mjs', import.meta.url)), path],
        stderr: 'pipe'
    });
    const client = new Client({ name: 'grouping-test-host', version: '0.0.1' });
    const notifications = [];
    const invalidationListeners = new Set();
    const invalidate = () => {
        for (const listener of invalidationListeners) listener();
    };
    client.onclose = invalidate;
    client.setNotificationHandler(ToolListChangedNotificationSchema, notification => {
        notifications.push(notification);
        invalidate();
    });
    // Drain stderr without treating it as protocol traffic.
    let stderr = '';
    transport.stderr.on('data', chunk => {
        stderr = (stderr + chunk.toString()).slice(-4096);
    });
    async function close() {
        try {
            await client.close();
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }
    try {
        await client.connect(transport, { timeout: 5000 });
    } catch (error) {
        await close();
        throw new Error(`${error.message}: ${stderr}`);
    }
    async function update() {
        await writeFile(`${path}.next`, JSON.stringify(state), { mode: 0o600 });
        await rename(`${path}.next`, path);
        // Ping is only a synchronization barrier. Mutation is out-of-band, never an MCP method.
        await client.request({ method: 'ping' }, ResultSchema, { timeout: 5000 });
    }
    return {
        notifications,
        pid: transport.pid,
        serverInfo: client.getServerVersion(),
        onInvalidated(listener) {
            invalidationListeners.add(listener);
            return () => invalidationListeners.delete(listener);
        },
        async request(request) {
            try {
                // connect() already performed the real SDK handshake. Never initialize twice.
                const result =
                    request.method === 'initialize'
                        ? { capabilities: client.getServerCapabilities() }
                        : await client.request({ method: request.method, params: request.params }, ResultSchema, { timeout: 5000 });
                // SDK owns wire IDs. The harness's ID is mapped back at this adapter boundary.
                return { jsonrpc: '2.0', id: request.id, result };
            } catch (error) {
                if (!(error instanceof McpError)) throw error;
                return { jsonrpc: '2.0', id: request.id, error: { code: error.code, message: error.message, data: error.data } };
            }
        },
        async replaceFixture(next) {
            state.fixture = structuredClone(next);
            await update();
        },
        async setAllowed(names) {
            state.allowed = [...names];
            await update();
        },
        close
    };
}
