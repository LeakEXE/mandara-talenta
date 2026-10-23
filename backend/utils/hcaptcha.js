const https = require('https');
const net = require('net');

const HCAPTCHA_HOST = 'api.hcaptcha.com';
const HCAPTCHA_PATH = '/siteverify';
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_TOKEN_LENGTH = 10000;
const MAX_RESPONSE_BYTES = 64 * 1024;

// hCaptcha returns a normal success:false response for bad/expired/reused
// tokens. These codes mean the *caller* supplied an invalid token, so the
// request should be rejected as a client error (and may consume the login
// attempt budget).
const TOKEN_REJECTION_CODES = new Set([
    'missing-input-response',
    'invalid-input-response',
    'expired-input-response',
    'already-seen-response',
    'invalid-or-already-seen-response'
]);

// hCaptcha's public test credentials always pass. Never allow them to become
// an accidental production bypass.
const TEST_SECRET = '0x0000000000000000000000000000000000000000';
const TEST_SITEKEY_PREFIX = '10000000-ffff-ffff-ffff-';
const isTestConfig = (secret, sitekey) => (
    secret === TEST_SECRET || sitekey.startsWith(TEST_SITEKEY_PREFIX)
);

const getConfig = () => ({
    secret: process.env.HCAPTCHA_SECRET_KEY || '',
    sitekey: process.env.HCAPTCHA_SITE_KEY || ''
});

const getTimeoutMs = () => {
    const configured = Number(process.env.HCAPTCHA_TIMEOUT_MS);
    if (!Number.isFinite(configured) || configured < 1000 || configured > 15000) {
        return DEFAULT_TIMEOUT_MS;
    }
    return configured;
};

const normalizeIp = (value) => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';

    // Express reports IPv4-mapped IPv6 addresses on some Node versions.
    const candidate = trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed;
    return net.isIP(candidate) ? candidate : '';
};

// Use the built-in https client instead of global fetch so the backend keeps
// working on the Node versions this project documents (fetch is Node 18+).
const postSiteverify = (formBody, timeoutMs) => new Promise((resolve, reject) => {
    const payload = formBody.toString();
    let settled = false;
    let timer;

    const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        callback(value);
    };

    const request = https.request({
        hostname: HCAPTCHA_HOST,
        port: 443,
        path: HCAPTCHA_PATH,
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(payload),
            Accept: 'application/json'
        }
    }, (response) => {
        let raw = '';
        let size = 0;

        response.setEncoding('utf8');
        response.on('data', (chunk) => {
            size += Buffer.byteLength(chunk);
            if (size > MAX_RESPONSE_BYTES) {
                response.destroy(new Error('response-too-large'));
                return;
            }
            raw += chunk;
        });
        response.on('end', () => finish(resolve, { statusCode: response.statusCode, raw }));
        response.on('error', (error) => finish(reject, error));
    });

    timer = setTimeout(() => {
        request.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    }, timeoutMs);

    request.on('error', (error) => finish(reject, error));
    request.on('close', () => {
        if (timer) clearTimeout(timer);
    });
    request.end(payload);
});

/**
 * Verify an hCaptcha token with the siteverify API.
 *
 * Returns:
 *   { ok: true }
 *   { ok: false, unavailable: false, reason: string } // invalid/reused token
 *   { ok: false, unavailable: true, reason: string }   // service/config outage
 *
 * The caller must fail closed for both failure kinds, but should return 503
 * (not 400) for `unavailable` so provider outages do not count as failed
 * credential attempts.
 */
const verifyHCaptcha = async (token, remoteip) => {
    const { secret, sitekey } = getConfig();

    if (!secret || !sitekey) {
        return { ok: false, unavailable: true, reason: 'not-configured' };
    }

    if (process.env.NODE_ENV === 'production' && isTestConfig(secret, sitekey)) {
        return { ok: false, unavailable: true, reason: 'test-keys-in-production' };
    }

    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
        return { ok: false, unavailable: false, reason: 'missing-or-invalid-token' };
    }

    // hCaptcha requires a form-encoded POST. URLSearchParams produces the
    // percent-encoded body; postSiteverify sets the matching Content-Type.
    const body = new URLSearchParams({ secret, sitekey, response: token });
    const normalizedIp = normalizeIp(remoteip);
    if (normalizedIp) {
        body.set('remoteip', normalizedIp);
    }

    try {
        const response = await postSiteverify(body, getTimeoutMs());

        if (response.statusCode < 200 || response.statusCode >= 300) {
            return { ok: false, unavailable: true, reason: `http-${response.statusCode}` };
        }

        let result;
        try {
            result = JSON.parse(response.raw);
        } catch {
            return { ok: false, unavailable: true, reason: 'invalid-json' };
        }

        if (result?.success === true) {
            return { ok: true };
        }

        const codes = Array.isArray(result?.['error-codes'])
            ? result['error-codes'].filter((code) => typeof code === 'string')
            : [];

        // Only token-specific rejections are the user's fault. Secret/sitekey
        // misconfiguration, bad requests, and unknown provider errors are
        // treated as an outage so they cannot burn the failed-login budget.
        const tokenRejected = codes.length > 0
            && codes.every((code) => TOKEN_REJECTION_CODES.has(code));

        return {
            ok: false,
            unavailable: !tokenRejected,
            reason: codes.length > 0 ? codes.join(',') : 'verification-failed'
        };
    } catch (error) {
        return {
            ok: false,
            unavailable: true,
            reason: error?.code === 'ETIMEDOUT' ? 'timeout' : 'network-error'
        };
    }
};

module.exports = {
    verifyHCaptcha,
    MAX_TOKEN_LENGTH
};
