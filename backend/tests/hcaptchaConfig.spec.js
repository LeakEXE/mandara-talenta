const test = require('node:test');
const assert = require('node:assert/strict');
const { isCaptchaDisabledInDevelopment } = require('../utils/hcaptcha');

test('allows the captcha bypass only when explicitly enabled in development', () => {
    assert.equal(isCaptchaDisabledInDevelopment({
        NODE_ENV: 'development',
        DISABLE_CAPTCHA: 'true'
    }), true);
    assert.equal(isCaptchaDisabledInDevelopment({
        NODE_ENV: 'development',
        DISABLE_CAPTCHA: 'false'
    }), false);
    assert.equal(isCaptchaDisabledInDevelopment({
        NODE_ENV: 'production',
        DISABLE_CAPTCHA: 'true'
    }), false);
    assert.equal(isCaptchaDisabledInDevelopment({
        DISABLE_CAPTCHA: 'true'
    }), false);
});
