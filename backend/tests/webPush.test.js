const test = require('node:test');
const assert = require('node:assert/strict');
const {
    validatePushEndpoint,
    validateSubscription,
    createPrivatePayload
} = require('../services/webPush');

const subscription = (endpoint) => ({
    endpoint,
    keys: {
        p256dh: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        auth: 'AAAAAAAAAAAAAAAAAAAAAA'
    }
});

test('accepts HTTPS endpoints from supported browser push services', () => {
    for (const endpoint of [
        'https://fcm.googleapis.com/fcm/send/test-token',
        'https://updates.push.services.mozilla.com/wpush/v2/test-token',
        'https://web.push.apple.com/test-token',
        'https://wns2.notify.windows.com/w/?token=test'
    ]) {
        assert.equal(validatePushEndpoint(endpoint), true, endpoint);
    }
});

test('rejects insecure, local, spoofed, or non-standard push endpoints', () => {
    for (const endpoint of [
        'http://fcm.googleapis.com/fcm/send/token',
        'https://localhost/fcm/send/token',
        'https://127.0.0.1/fcm/send/token',
        'https://fcm.googleapis.com.attacker.example/token',
        'https://tenant.fcm.googleapis.com/token',
        'https://user@fcm.googleapis.com/token',
        'https://fcm.googleapis.com:8443/token',
        'https://example.com/token'
    ]) {
        assert.equal(validatePushEndpoint(endpoint), false, endpoint);
    }
});

test('validates the subscription endpoint and Web Push key sizes', () => {
    assert.equal(validateSubscription(subscription('https://fcm.googleapis.com/fcm/send/token')), null);
    assert.match(validateSubscription(subscription('http://fcm.googleapis.com/token')), /endpoint/i);
    assert.match(validateSubscription({
        endpoint: 'https://fcm.googleapis.com/fcm/send/token',
        keys: { p256dh: 'bad', auth: 'bad' }
    }), /keys/i);
    assert.match(validateSubscription(null), /required/i);
});

test('push payload is generic and directs the user to the notification center', () => {
    const payload = createPrivatePayload(42);
    assert.deepEqual(payload, {
        title: 'Mandara Talenta',
        body: 'Anda memiliki notifikasi baru. Buka aplikasi untuk melihatnya.',
        url: '/notifications',
        tag: 'mandara-42'
    });
    assert.equal(JSON.stringify(payload).includes('nama'), false);
});
