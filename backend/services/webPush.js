const webpush = require('web-push');
const db = require('../config/database');

const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 8;
const POLL_INTERVAL_MS = 5000;
const STALE_LOCK_MINUTES = 5;
const DELIVERY_RETENTION_DAYS = 90;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

let configured = false;
let configurationChecked = false;
let polling = false;
let workerTimer = null;
let lastCleanupAt = 0;

function configureWebPush() {
    if (configurationChecked) return configured;
    configurationChecked = true;

    const publicKey = process.env.WEB_PUSH_PUBLIC_KEY;
    const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
    const subject = process.env.WEB_PUSH_SUBJECT;
    if (!publicKey && !privateKey && !subject) {
        console.warn('[web-push] VAPID is not configured; push delivery is disabled.');
        return false;
    }
    if (!publicKey || !privateKey || !subject) {
        console.error('[web-push] VAPID configuration is incomplete; push delivery is disabled.');
        return false;
    }
    let parsedSubject;
    try {
        parsedSubject = new URL(subject);
    } catch {
        parsedSubject = null;
    }
    const validSubject = parsedSubject && (
        (parsedSubject.protocol === 'mailto:' && parsedSubject.pathname.includes('@'))
        || (parsedSubject.protocol === 'https:' && parsedSubject.hostname
            && !parsedSubject.username && !parsedSubject.password)
    );
    if (!validSubject) {
        console.error('[web-push] WEB_PUSH_SUBJECT must be a mailto: or HTTPS contact URI.');
        return false;
    }

    try {
        webpush.setVapidDetails(subject, publicKey, privateKey);
        configured = true;
        console.log('[web-push] VAPID delivery configured.');
    } catch (error) {
        console.error('[web-push] Invalid VAPID configuration:', error.message);
    }
    return configured;
}

function getPublicKey() {
    return configureWebPush() ? process.env.WEB_PUSH_PUBLIC_KEY : null;
}

function decodeBase64Url(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized, 'base64');
}

function validatePushEndpoint(value) {
    if (typeof value !== 'string' || value.length > 4096) return false;
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        return false;
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
        return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    return hostname === 'fcm.googleapis.com'
        || hostname === 'web.push.apple.com'
        || hostname === 'push.services.mozilla.com'
        || hostname.endsWith('.push.services.mozilla.com')
        || hostname === 'notify.windows.com'
        || hostname.endsWith('.notify.windows.com');
}

function validateSubscription(subscription) {
    if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription)) {
        return 'Push subscription is required';
    }
    if (!validatePushEndpoint(subscription.endpoint)) {
        return 'Push endpoint is not supported';
    }
    const keys = subscription.keys;
    if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
        return 'Push subscription keys are invalid';
    }
    if (keys.p256dh.length > 90 || keys.auth.length > 24
        || !/^[A-Za-z0-9_-]+={0,2}$/.test(keys.p256dh)
        || !/^[A-Za-z0-9_-]+={0,2}$/.test(keys.auth)) {
        return 'Push subscription keys are invalid';
    }
    if (decodeBase64Url(keys.p256dh).length !== 65 || decodeBase64Url(keys.auth).length !== 16) {
        return 'Push subscription keys are invalid';
    }
    return null;
}

function createPrivatePayload(queueId) {
    return {
        title: 'Mandara Talenta',
        body: 'Anda memiliki notifikasi baru. Buka aplikasi untuk melihatnya.',
        url: '/notifications',
        tag: `mandara-${queueId}`
    };
}

async function claimDeliveries() {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const [claimed] = await conn.query(
            `WITH candidates AS (
                SELECT id
                FROM push_delivery_queue
                WHERE (status = 'pending' AND available_at <= NOW())
                   OR (status = 'processing' AND locked_at < NOW() - (? * INTERVAL '1 minute'))
                ORDER BY available_at, id
                LIMIT ?
                FOR UPDATE SKIP LOCKED
            )
            UPDATE push_delivery_queue q
            SET status = 'processing', locked_at = NOW(), attempts = q.attempts + 1
            FROM candidates c
            WHERE q.id = c.id
            RETURNING q.id`,
            [STALE_LOCK_MINUTES, BATCH_SIZE]
        );
        const ids = claimed.map((row) => row.id);
        if (ids.length === 0) {
            await conn.commit();
            return [];
        }
        const [deliveries] = await conn.query(
            `SELECT q.id, q.attempts, s.id AS subscription_id, s.endpoint, s.p256dh, s.auth
             FROM push_delivery_queue q
             JOIN push_subscriptions s ON s.id = q.subscription_id
             WHERE q.id IN (?)`,
            [ids]
        );
        await conn.commit();
        return deliveries;
    } catch (error) {
        try {
            await conn.rollback();
        } catch (rollbackError) {
            console.error('[web-push] Failed to roll back queue claim:', rollbackError.message);
        }
        throw error;
    } finally {
        conn.release();
    }
}

async function markDeliverySent(id) {
    await db.query(
        `UPDATE push_delivery_queue
         SET status = 'sent', sent_at = NOW(), locked_at = NULL, last_error = NULL
         WHERE id = ? AND status = 'processing'`,
        [id]
    );
}

async function removeExpiredSubscription(subscriptionId) {
    await db.query('DELETE FROM push_subscriptions WHERE id = ?', [subscriptionId]);
}

async function retryOrFailDelivery(delivery, error) {
    const statusCode = Number(error.statusCode) || 0;
    const attempts = Number(delivery.attempts);
    if (statusCode === 404 || statusCode === 410) {
        await removeExpiredSubscription(delivery.subscription_id);
        console.info(`[web-push] Removed expired subscription after push-service status ${statusCode}.`);
        return;
    }

    const permanentlyFailed = attempts >= MAX_ATTEMPTS;
    const retrySeconds = Math.min(900, 30 * (2 ** Math.max(0, attempts - 1)));
    const safeError = statusCode ? `push_status_${statusCode}` : 'push_delivery_error';
    await db.query(
        `UPDATE push_delivery_queue
         SET status = ?, available_at = NOW() + (? * INTERVAL '1 second'),
             locked_at = NULL, last_error = ?
         WHERE id = ? AND status = 'processing'`,
        [permanentlyFailed ? 'failed' : 'pending', permanentlyFailed ? 0 : retrySeconds, safeError, delivery.id]
    );
    if (permanentlyFailed) {
        console.error(`[web-push] Delivery ${delivery.id} failed after ${attempts} attempts (${safeError}).`);
    }
}

async function deliverOne(delivery) {
    try {
        await webpush.sendNotification(
            {
                endpoint: delivery.endpoint,
                keys: { p256dh: delivery.p256dh, auth: delivery.auth }
            },
            JSON.stringify(createPrivatePayload(delivery.id)),
            { TTL: 3600, urgency: 'normal', topic: `mt${delivery.id}` }
        );
        await markDeliverySent(delivery.id);
    } catch (error) {
        try {
            await retryOrFailDelivery(delivery, error);
        } catch (recordError) {
            console.error(`[web-push] Could not record delivery ${delivery.id} failure:`, recordError.message);
            return;
        }
        if (![404, 410].includes(Number(error.statusCode))) {
            console.warn(`[web-push] Delivery ${delivery.id} failed (status ${Number(error.statusCode) || 'unknown'}).`);
        }
    }
}

async function processPushQueue() {
    if (polling || !configureWebPush()) return;
    polling = true;
    try {
        if (Date.now() - lastCleanupAt >= CLEANUP_INTERVAL_MS) {
            await db.query(
                `DELETE FROM push_delivery_queue
                 WHERE status IN ('sent', 'failed')
                   AND created_at < NOW() - (? * INTERVAL '1 day')`,
                [DELIVERY_RETENTION_DAYS]
            );
            lastCleanupAt = Date.now();
        }
        const deliveries = await claimDeliveries();
        await Promise.all(deliveries.map(deliverOne));
    } catch (error) {
        console.error('[web-push] Queue processing failed:', error.message);
    } finally {
        polling = false;
    }
}

function startPushWorker() {
    if (!configureWebPush() || workerTimer) return;
    workerTimer = setInterval(processPushQueue, POLL_INTERVAL_MS);
    workerTimer.unref();
    processPushQueue();
}

module.exports = {
    configureWebPush,
    getPublicKey,
    validatePushEndpoint,
    validateSubscription,
    createPrivatePayload,
    startPushWorker,
    processPushQueue
};
