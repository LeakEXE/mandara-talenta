const db = require('../config/database');

// Username policy: 5-20 chars, letters + numbers + !@#_ only (no spaces possible).
// User-chosen usernames may still contain numbers/symbols; auto-generated
// usernames are always letter-only (see generateUsername).
const USERNAME_RE = /^[A-Za-z0-9!@#_]{5,20}$/;
const USERNAME_MIN = 5;
const USERNAME_MAX = 20;
// Auto-generated usernames must be letter-only.
const GENERATED_USERNAME_RE = /^[A-Za-z]{5,20}$/;

// Returns null when valid, otherwise an Indonesian error message.
function validateUsernameFormat(username) {
    if (typeof username !== 'string' || username.length === 0) {
        return 'Username wajib diisi';
    }
    if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
        return `Username harus ${USERNAME_MIN}-${USERNAME_MAX} karakter`;
    }
    if (!USERNAME_RE.test(username)) {
        return 'Username hanya boleh berisi huruf, angka, dan !@#_ (tanpa spasi)';
    }
    return null;
}

// Case-insensitive availability check (optionally excluding one user id,
// so users can keep their own name).
async function isUsernameAvailable(username, excludeUserId = null) {
    const params = [username];
    let sql = 'SELECT id FROM users WHERE LOWER(username) = LOWER(?)';
    if (excludeUserId !== null && excludeUserId !== undefined) {
        sql += ' AND id <> ?';
        params.push(excludeUserId);
    }
    const [rows] = await db.query(sql, params);
    return rows.length === 0;
}

// Auto-generate a username from a person's name. No randomness: the base is
// the letter-only slug of the name, minus the LAST word (usually the family
// name, which would make it too long), lowercased and truncated to 20 chars:
// "I Komang Sumawa Adi Putra" -> "ikomangsumawaadi". Short/empty results
// fall back to the full-name slug, then pad by repeating the slug,
// e.g. 'bo' -> 'bobob'.
// Uniqueness (no random suffix):
//  1. plain slug when free, e.g. 'deanputra';
//  2. slug + meaningful suffix derived from NIS/NIP (digits mapped a-j),
//     e.g. 'deanputrabcdef' for NIS 12345 — unique because NIS/NIP is unique;
//  3. slug + deterministic a, b, ... z, aa, ab... enumeration as last resort.
function slugFromName(nama) {
    const words = String(nama || '').trim().split(/\s+/).filter(Boolean);
    // Drop the last word so the base stays short and readable.
    const dropped = words.length > 1 ? words.slice(0, -1).join('') : (words[0] || '');
    let slug = dropped.toLowerCase().replace(/[^a-z]/g, '').slice(0, USERNAME_MAX);
    // Too short after dropping (e.g. "I Putra" -> "i")? Fall back to full name.
    if (slug.length < USERNAME_MIN) {
        slug = String(nama || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, USERNAME_MAX) || 'user';
    }
    while (slug.length < USERNAME_MIN) slug = (slug + slug).slice(0, USERNAME_MIN);
    return slug;
}

// Meaningful letter-only suffix from NIS/NIP: keep a-z, map 0-9 -> a-j,
// drop everything else. Returns '' when the hint carries no usable characters.
function meaningfulSuffix(hint) {
    if (hint === null || hint === undefined) return '';
    return String(hint).toLowerCase().replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]).replace(/[^a-z]/g, '');
}

// Deterministic enumeration suffix: 0->a, 1->b, ... 25->z, 26->aa, 27->ab...
function enumSuffix(i) {
    let s = '';
    let n = i;
    do {
        s = String.fromCharCode(97 + (n % 26)) + s;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return s;
}

function extractHint(hint) {
    if (hint === null || hint === undefined) return '';
    if (typeof hint === 'object') return meaningfulSuffix(hint.nis || hint.nip || hint.id || '');
    return meaningfulSuffix(hint);
}

async function generateUsername(nama, hint) {
    const base = slugFromName(nama);
    const excludeUserId = hint && typeof hint === 'object' ? (hint.excludeUserId ?? null) : null;
    // eslint-disable-next-line no-await-in-loop
    if (await isUsernameAvailable(base, excludeUserId)) {
        return base;
    }
    const meaningful = extractHint(hint);
    if (meaningful) {
        const candidate = (base + meaningful).slice(0, USERNAME_MAX);
        if (candidate.length >= USERNAME_MIN && GENERATED_USERNAME_RE.test(candidate)) {
            // eslint-disable-next-line no-await-in-loop
            if (await isUsernameAvailable(candidate, excludeUserId)) {
                return candidate;
            }
        }
    }
    for (let i = 0; i < 5000; i++) {
        const suffix = enumSuffix(i);
        const candidate = (base + suffix).slice(0, USERNAME_MAX);
        if (candidate.length < USERNAME_MIN || !GENERATED_USERNAME_RE.test(candidate)) continue;
        // eslint-disable-next-line no-await-in-loop
        if (await isUsernameAvailable(candidate, excludeUserId)) {
            return candidate;
        }
    }
    throw new Error('Gagal membuat username unik, coba lagi');
}

module.exports = {
    USERNAME_RE,
    GENERATED_USERNAME_RE,
    USERNAME_MIN,
    USERNAME_MAX,
    validateUsernameFormat,
    isUsernameAvailable,
    generateUsername
};
