const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUserPrestasiHistoryQuery } = require('../utils/prestasiHistory');

test('prestasi history query expands only groups represented in the user history', () => {
    const { sql, params } = buildUserPrestasiHistoryQuery(42);

    assert.match(sql, /user_id = \? OR submitted_by = \?/);
    assert.match(sql, /grup_lomba IN \([\s\S]*SELECT grup_lomba[\s\S]*FROM prestasi_approvals/);
    assert.match(sql, /WHERE \(user_id = \? OR submitted_by = \?\)/);
    assert.match(sql, /AND grup_lomba IS NOT NULL/);
    assert.deepEqual(params, [42, 42, 42, 42]);
});
