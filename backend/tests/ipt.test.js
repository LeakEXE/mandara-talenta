const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveRequiredPembina } = require('../utils/ipt');
const { assertEvidenceRequired } = require('../utils/evidenceUpload');

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

test('rejects IPT submissions without evidence', () => {
    assert.throws(
        () => assertEvidenceRequired([]),
        { statusCode: 400, message: 'Minimal satu file bukti wajib diunggah' }
    );
    assert.throws(
        () => assertEvidenceRequired(undefined),
        { statusCode: 400, message: 'Minimal satu file bukti wajib diunggah' }
    );
});

test('accepts IPT submissions with evidence', () => {
    assert.doesNotThrow(() => assertEvidenceRequired([{ filename: 'evidence.pdf' }]));
});
