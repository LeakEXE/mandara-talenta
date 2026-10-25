const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveRequiredPembina } = require('../utils/ipt');

test('rejects prestasi submissions without a pembina', async () => {
    await assert.rejects(
        resolveRequiredPembina('', '', []),
        { statusCode: 400, message: 'Pembina wajib dipilih.' }
    );
});

test('rejects empty multi-pembina selections sent as JSON', async () => {
    await assert.rejects(
        resolveRequiredPembina(null, null, '[]'),
        { statusCode: 400, message: 'Pembina wajib dipilih.' }
    );
});
