import { canonical, digest, GROUPING } from '../../../../experiments/deterministic-groups/reference.mjs';

// Asynchronous single-connection Host model. No external provider is contacted.
export class GroupingHost {
    constructor(connection) {
        this.connection = connection;
        this.active = new Map();
        this.generation = 0;
        this.sequence = 0;
        this.unsubscribe = connection.onInvalidated(() => this.invalidate());
    }
    invalidate() {
        this.generation++;
        this.active.clear();
    }
    async rpc(method, params) {
        const response = await this.connection.request({ jsonrpc: '2.0', id: ++this.sequence, method, params });
        if (response.error) throw new Error(response.error.message);
        return response.result;
    }
    async connect() {
        this.invalidate();
        this.capabilities = (await this.rpc('initialize')).capabilities;
    }
    async activate(group) {
        this.invalidate();
        const generation = this.generation;
        const current = () => {
            if (generation !== this.generation) throw new Error('Activation invalidated; rediscover');
        };
        if (!this.capabilities) throw new Error('Connect before activation');
        let tools;
        const grouping = this.capabilities.experimental?.[GROUPING];
        if (grouping?.version === 1 && (this.capabilities.tools?.manifest === true || grouping.manifest === true)) {
            const directory = await this.rpc('experimental/groups/list');
            current();
            const selected = await this.rpc('experimental/groups/expand', { id: group, revision: directory.revision });
            current();
            if (selected.revision !== directory.revision) throw new Error('Expansion revision mismatch');
            if (new Set(selected.entries.map(e => e.name)).size !== selected.entries.length) throw new Error('Duplicate entries');
            tools = [];
            for (let i = 0; i < selected.entries.length; i += 50) {
                const entries = selected.entries.slice(i, i + 50);
                const described = (await this.rpc('tools/describe', { names: entries.map(e => e.name) })).tools;
                current();
                if (described.length !== entries.length) throw new Error('Incomplete describe');
                described.forEach((tool, index) => {
                    const entry = entries[index];
                    if (tool.name !== entry.name || digest(tool) !== entry.digest || Buffer.byteLength(canonical(tool)) !== entry.size)
                        throw new Error('Definition mismatch');
                    if (!tool._meta?.[GROUPING]?.groups?.includes(group)) throw new Error('Membership mismatch');
                });
                tools.push(...described);
            }
            if ((await this.rpc('experimental/groups/list')).revision !== directory.revision) throw new Error('View changed');
        } else {
            tools = (await this.rpc('tools/list')).tools;
        }
        current();
        // Build the full candidate before publishing any native registrations.
        const next = new Map();
        for (const tool of tools) {
            if (next.has(tool.name)) throw new Error('Duplicate tool identity');
            if (tool._meta?.[GROUPING]?.callable !== false) next.set(tool.name, structuredClone(tool));
        }
        this.active = next;
        return this.providerTools();
    }
    providerTools() {
        return [...this.active.values()].map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: structuredClone(tool.inputSchema)
            }
        }));
    }
    async call(name, args = {}) {
        if (!this.active.has(name)) throw new Error('Tool is not active');
        return this.rpc('tools/call', { name, arguments: args });
    }
    dispose() {
        this.invalidate();
        this.unsubscribe();
        this.capabilities = undefined;
    }
}
