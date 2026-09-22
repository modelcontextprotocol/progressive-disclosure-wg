import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as adapter from './adapter.mjs';
import { runSuite } from '../../../../experiments/deterministic-groups/conformance/suite.mjs';

test('portable server contract over actual SDK stdio subprocesses', { timeout: 30000 }, async () => {
    const report = await runSuite(adapter);
    assert.ok(
        report.results.every(r => r.status === 'passed'),
        JSON.stringify(report)
    );
});

test('real handshake, notification delivery, revocation and subprocess shutdown', { timeout: 15000 }, async () => {
    const fixture = JSON.parse(
        await readFile(new URL('../../../../experiments/deterministic-groups/conformance/fixture.json', import.meta.url))
    );
    const connection = await adapter.createAdapter({ fixture, allowed: fixture.tools.map(t => t.name) });
    const pid = connection.pid;
    try {
        assert.ok(pid && pid !== process.pid);
        assert.equal(connection.serverInfo.name, 'grouping-test-bridge');
        await connection.setAllowed(['server_version']);
        assert.equal(connection.notifications.length, 1);
        assert.equal(connection.notifications[0].method, 'notifications/tools/list_changed');
        const denied = await connection.request({ id: 12, method: 'tools/call', params: { name: 'list_tables', arguments: {} } });
        assert.equal(denied.error.code, -32602);
        const allowed = await connection.request({ id: 13, method: 'tools/call', params: { name: 'server_version', arguments: {} } });
        assert.equal(allowed.result.content[0].text, 'Executed server_version');
        await connection.setAllowed(['server_version']);
        assert.equal(connection.notifications.length, 1, 'unchanged view must not emit another notification');
    } finally {
        await connection.close();
    }
    assert.throws(
        () => process.kill(pid, 0),
        e => e.code === 'ESRCH'
    );
});
