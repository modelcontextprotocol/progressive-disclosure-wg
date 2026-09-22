import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAdapter } from './adapter.mjs';
import { GroupingHost } from './host.mjs';

const fixture = JSON.parse(
    await readFile(new URL('../../../../experiments/deterministic-groups/conformance/fixture.json', import.meta.url))
);
async function setup(t, options = {}) {
    const connection = await createAdapter({ fixture, allowed: fixture.tools.map(tool => tool.name), options });
    const host = new GroupingHost(connection);
    t.after(async () => {
        host.dispose();
        await connection.close();
    });
    await host.connect();
    return { connection, host };
}
test('SDK Host activates selected native-shaped definitions and switches exact groups', { timeout: 10000 }, async t => {
    const { host } = await setup(t);
    assert.equal(host.capabilities.experimental['experimental/deterministic-groups'].manifest, true);
    const native = await host.activate('query');
    assert.deepEqual(
        native.map(t => t.function.name),
        ['list_tables', 'server_version']
    );
    assert.deepEqual(native[0].function.parameters, fixture.tools[0].inputSchema);
    assert.equal((await host.call('list_tables')).content[0].text, 'Executed list_tables');
    await host.activate('operations');
    await assert.rejects(host.call('list_tables'), /not active/);
    assert.equal((await host.call('cluster_health')).content[0].text, 'Executed cluster_health');
});
test('SDK notification evicts registrations before rediscovery; disconnect clears them', { timeout: 10000 }, async t => {
    const { host, connection } = await setup(t);
    await host.activate('query');
    await connection.setAllowed(['server_version']);
    assert.deepEqual(host.providerTools(), []);
    await assert.rejects(host.call('list_tables'), /not active/);
    assert.deepEqual(
        (await host.activate('query')).map(t => t.function.name),
        ['server_version']
    );
    await connection.close();
    assert.deepEqual(host.providerTools(), []);
});
test('late describe cannot republish registrations after revocation', { timeout: 10000 }, async t => {
    const { host, connection } = await setup(t);
    const send = connection.request.bind(connection);
    let release;
    const gate = new Promise(resolve => {
        release = resolve;
    });
    let arrived;
    const ready = new Promise(resolve => {
        arrived = resolve;
    });
    connection.request = async request => {
        const response = await send(request);
        if (request.method === 'tools/describe') {
            arrived();
            await gate;
        }
        return response;
    };
    const activation = host.activate('query');
    const rejected = assert.rejects(activation, /invalidated/);
    await ready;
    try {
        await connection.setAllowed(['server_version']);
    } finally {
        release();
    }
    await rejected;
    assert.deepEqual(host.providerTools(), []);
});
test('a slow old group never overwrites a newer activation', { timeout: 10000 }, async t => {
    const { host, connection } = await setup(t);
    const send = connection.request.bind(connection);
    let release;
    const gate = new Promise(resolve => {
        release = resolve;
    });
    let arrived;
    const ready = new Promise(resolve => {
        arrived = resolve;
    });
    connection.request = async request => {
        const response = await send(request);
        if (request.method === 'tools/describe' && request.params.names.includes('list_tables')) {
            arrived();
            await gate;
        }
        return response;
    };
    const old = assert.rejects(host.activate('query'), /invalidated/);
    await ready;
    try {
        await host.activate('operations');
    } finally {
        release();
    }
    await old;
    assert.deepEqual(
        host.providerTools().map(t => t.function.name),
        ['cluster_health', 'server_version']
    );
});
test('legacy SDK path activates tools/list without grouping methods', { timeout: 10000 }, async t => {
    const { host, connection } = await setup(t, { manifest: false });
    const methods = [];
    const send = connection.request.bind(connection);
    connection.request = r => {
        methods.push(r.method);
        return send(r);
    };
    assert.equal((await host.activate('query')).length, 3);
    assert.deepEqual(methods, ['tools/list']);
});
