const LOGIN_TTL = 600;
const SESSION_TTL = 86400 * 90;
const now = () => Math.floor(Date.now() / 1000);
const random = (bytes = 32) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('');
const hash = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
const constantEqual = (a, b) => { a = String(a || ''); b = String(b || ''); let diff = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return diff === 0; };
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
async function body(request, max = 1024 * 512) {
    const reader = request.body?.getReader(); if (!reader) return {};
    const chunks = []; let size = 0;
    while (true) { const {done, value} = await reader.read(); if (done) break; size += value.length; if (size > max) { await reader.cancel(); fail(413, 'Завеликий запит'); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(400, 'Некоректний JSON'); }
}
function validState(value, depth = 0) {
    if (depth > 12) return false;
    if (!value || typeof value !== 'object') return typeof value !== 'string' || value.length <= 30000;
    if (Array.isArray(value) && value.length > 3000) return false;
    return Object.keys(value).every(key => !['__proto__', 'constructor', 'prototype'].includes(key) && validState(value[key], depth + 1));
}
const statement = (env, sql, ...values) => env.DB.prepare(sql).bind(...values);
async function rate(env, key, max, seconds) {
    const bucket = Math.floor(now() / seconds);
    const row = await statement(env, 'INSERT INTO limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count', key + ':' + bucket, now() + seconds).first();
    if (row.count > max) fail(429, 'Забагато спроб. Спробуйте пізніше.');
}
async function session(request, env) {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
    if (!/^[a-f0-9]{64}$/.test(token)) fail(401, 'Увійдіть через Telegram');
    const tokenHash = await hash(token);
    const row = await statement(env, 'SELECT sessions.*, users.name FROM sessions JOIN users USING(telegram_id) WHERE token_hash=? AND expires_at>?', tokenHash, now()).first();
    if (!row) fail(401, 'Сесія завершилась. Увійдіть ще раз.');
    return {...row, tokenHash};
}
async function cleanup(env) {
    await env.DB.batch([
        statement(env, 'DELETE FROM logins WHERE expires_at<?', now()),
        statement(env, 'DELETE FROM sessions WHERE expires_at<?', now()),
        statement(env, 'DELETE FROM limits WHERE expires_at<?', now())
    ]);
}
export function createService(fetchImpl = fetch) {
    async function telegram(env, method, data) {
        const response = await fetchImpl('https://api.telegram.org/bot' + env.BOT_TOKEN + '/' + method, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(data)});
        const result = await response.json(); if (!response.ok || !result.ok) throw new Error('telegram_unavailable'); return result.result;
    }
    async function webhook(request, env) {
        if (!env.TELEGRAM_WEBHOOK_SECRET || !constantEqual(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), env.TELEGRAM_WEBHOOK_SECRET)) fail(403, 'Доступ заборонено');
        const update = await body(request, 65536);
        if (update.callback_query) {
            const callback = update.callback_query;
            const match = /^approve:([a-f0-9]{32})$/.exec(callback.data || '');
            if (!match) return {ok: true};
            const row = await statement(env, 'SELECT * FROM logins WHERE id=? AND telegram_id=? AND expires_at>? AND consumed=0', match[1], String(callback.from.id), now()).first();
            if (!row) { await telegram(env, 'answerCallbackQuery', {callback_query_id: callback.id, text: 'Код недійсний або вже використаний'}); return {ok: true}; }
            await env.DB.batch([
                statement(env, 'INSERT INTO users(telegram_id,name,created_at) VALUES(?,?,?) ON CONFLICT(telegram_id) DO UPDATE SET name=excluded.name', String(callback.from.id), String(callback.from.first_name || 'Користувач').slice(0, 80), now()),
                statement(env, 'INSERT OR IGNORE INTO states(telegram_id) VALUES(?)', String(callback.from.id)),
                statement(env, 'UPDATE logins SET approved=1 WHERE id=? AND telegram_id=? AND expires_at>? AND consumed=0', row.id, String(callback.from.id), now())
            ]);
            await telegram(env, 'answerCallbackQuery', {callback_query_id: callback.id, text: 'Вхід підтверджено. Поверніться до телевізора.'});
            await telegram(env, 'sendMessage', {chat_id: callback.from.id, text: '✅ Вхід у XOTT TV підтверджено. Поверніться до телевізора.\nДля виходу з усіх пристроїв: /logoutall'});
            return {ok: true};
        }
        const message = update.message;
        if (!message || message.chat?.type !== 'private' || message.from?.is_bot) return {ok: true};
        const uid = String(message.from.id);
        await rate(env, 'tg:' + uid, 20, 60);
        if ((message.text || '').trim() === '/logoutall') {
            await env.DB.batch([statement(env, 'DELETE FROM sessions WHERE telegram_id=?', uid), statement(env, 'DELETE FROM logins WHERE telegram_id=?', uid)]);
            await telegram(env, 'sendMessage', {chat_id: uid, text: 'Усі пристрої вийшли з акаунта.'}); return {ok: true};
        }
        const match = /^(?:\/start(?:@\w+)?\s+)?(?:login_)?([A-HJ-NP-Z2-9]{8})$/i.exec((message.text || '').trim().replace(/([A-Z2-9]{4})-([A-Z2-9]{4})/i, '$1$2'));
        if (!match) { await telegram(env, 'sendMessage', {chat_id: uid, text: 'Вітаємо у XOTT TV! Відкрийте на телевізорі «Налаштування → XOTT TV → Увійти через Telegram» і надішліть сюди код з екрана.\nНікому не передавайте код входу. /logoutall — вихід з усіх пристроїв.'}); return {ok: true}; }
        const row = await statement(env, 'UPDATE logins SET telegram_id=? WHERE code=? AND expires_at>? AND consumed=0 AND (telegram_id IS NULL OR telegram_id=?) RETURNING *', uid, match[1].toUpperCase(), now(), uid).first();
        if (!row) { await telegram(env, 'sendMessage', {chat_id: uid, text: 'Код недійсний або прострочений. Створіть новий на телевізорі.'}); return {ok: true}; }
        await telegram(env, 'sendMessage', {chat_id: uid, text: 'Підтвердити вхід у XOTT TV?\nКод: ' + row.code.slice(0, 4) + '-' + row.code.slice(4) + '\nПристрій: ' + row.device + '\n\nНатискайте лише якщо цей код зараз показано на вашому екрані.', reply_markup: {inline_keyboard: [[{text: '✅ Підтвердити вхід', callback_data: 'approve:' + row.id}]]}});
        return {ok: true};
    }
    async function handle(request, env) {
        const url = new URL(request.url), route = url.pathname;
        if (route === '/telegram' && request.method === 'POST') return webhook(request, env);
        const origin = request.headers.get('origin');
        if (origin && origin !== env.APP_ORIGIN) fail(403, 'Цей сайт не дозволений');
        if (route === '/api/health' && request.method === 'GET') return {ok: true, service: 'XOTT TV', version: '2.0.0'};
        if (route === '/api/config' && request.method === 'GET') return {telegram: !!env.BOT_TOKEN && /^[a-zA-Z0-9_]{5,32}$/.test(env.BOT_USERNAME || '') && !env.BOT_USERNAME.startsWith('REPLACE_'), bot: env.BOT_USERNAME || '', catalog: !!env.CATALOG_URL};
        if (route === '/api/login/start' && request.method === 'POST') {
            if (!env.BOT_TOKEN || !env.BOT_USERNAME || env.BOT_USERNAME.startsWith('REPLACE_')) fail(503, 'Telegram-бот ще не налаштований на сервері');
            await rate(env, 'ip:' + await hash(request.headers.get('CF-Connecting-IP') || 'local'), 10, 600);
            const input = await body(request, 1024); const device = String(input.device || 'Телевізор').replace(/[\r\n]/g, ' ').slice(0, 80);
            const id = random(16), pollToken = random();
            const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), n => alphabet[n % 32]).join('');
            await statement(env, 'INSERT INTO logins(id,code,poll_hash,device,expires_at) VALUES(?,?,?,?,?)', id, code, await hash(pollToken), device, now() + LOGIN_TTL).run();
            return {id, code, poll_token: pollToken, expires_in: LOGIN_TTL, interval: 5, url: 'https://t.me/' + env.BOT_USERNAME + '?start=login_' + code};
        }
        if (route === '/api/login/poll' && request.method === 'POST') {
            const input = await body(request, 1024);
            if (!/^[a-f0-9]{32}$/.test(input.id || '') || !/^[a-f0-9]{64}$/.test(input.poll_token || '')) fail(400, 'Некоректний запит');
            await rate(env, 'poll:' + input.id, 25, 60);
            const row = await statement(env, 'SELECT * FROM logins WHERE id=?', input.id).first();
            if (!row || row.expires_at <= now()) fail(410, 'Код прострочено');
            if (!constantEqual(row.poll_hash, await hash(input.poll_token))) fail(403, 'Доступ заборонено');
            if (row.consumed) fail(410, 'Код уже використаний');
            if (!row.approved) return {status: 'pending'};
            const token = random();
            const result = await env.DB.batch([
                statement(env, 'INSERT INTO sessions(token_hash,telegram_id,device,expires_at) SELECT ?,telegram_id,device,? FROM logins WHERE id=? AND consumed=0 AND approved=1 AND expires_at>?', await hash(token), now() + SESSION_TTL, row.id, now()),
                statement(env, 'UPDATE logins SET consumed=1 WHERE id=? AND consumed=0 AND approved=1', row.id)
            ]);
            if (!result[0].meta.changes) fail(410, 'Код уже використаний');
            return {status: 'approved', token, expires_in: SESSION_TTL};
        }
        const user = await session(request, env);
        if (route === '/api/me' && request.method === 'GET') return {id: await hash('user:' + user.telegram_id), name: user.name, device: user.device, expires_at: user.expires_at};
        if (route === '/api/logout' && request.method === 'POST') { await statement(env, 'DELETE FROM sessions WHERE token_hash=?', user.tokenHash).run(); return {ok: true}; }
        if (route === '/api/state' && request.method === 'GET') {
            const row = await statement(env, 'SELECT version,data FROM states WHERE telegram_id=?', user.telegram_id).first(); return {version: row?.version || 0, data: JSON.parse(row?.data || '{}')};
        }
        if (route === '/api/state' && request.method === 'PUT') {
            const input = await body(request);
            if (!Number.isInteger(input.version) || input.version < 0 || !input.data || typeof input.data !== 'object' || Array.isArray(input.data)) fail(400, 'Некоректні дані синхронізації');
            if (!validState(input.data)) fail(400, 'Некоректна структура даних');
            const allowed = ['favorite', 'file_view'];
            if (Object.keys(input.data).some(key => !allowed.includes(key)) || allowed.some(key => input.data[key] && (typeof input.data[key] !== 'object' || Array.isArray(input.data[key])))) fail(400, 'Недозволені дані');
            await rate(env, 'sync:' + user.telegram_id, 60, 60);
            const updated = await statement(env, 'UPDATE states SET data=?,version=version+1 WHERE telegram_id=? AND version=? RETURNING version', JSON.stringify(input.data), user.telegram_id, input.version).first();
            if (!updated) fail(409, 'Дані змінилися на іншому пристрої'); return {version: updated.version};
        }
        if (route === '/api/sources' && request.method === 'GET') {
            if (!env.CATALOG_URL) return {streams: [], configured: false};
            if (!/^https:\/\//.test(env.CATALOG_URL)) fail(503, 'Каталог не налаштований');
            await rate(env, 'sources:' + user.telegram_id, 60, 60);
            const response = await fetchImpl(env.CATALOG_URL, {headers: {accept: 'application/json'}, signal: AbortSignal.timeout(15000)});
            if (!response.ok) fail(502, 'Каталог недоступний');
            const feed = await body(response, 1024 * 1024);
            const kind = url.searchParams.get('type') === 'tv' ? 'tv' : 'movie';
            const items = (Array.isArray(feed.items) ? feed.items : []).filter(item => String(item.tmdb_id) === url.searchParams.get('tmdb_id') && (item.type || 'movie') === kind);
            return {configured: true, streams: items.flatMap(item => Array.isArray(item.streams) ? item.streams : []).filter(stream => /^https:\/\//.test(stream.url || '') && /\.(mp4|m3u8|webm)(?:[?#]|$)/i.test(stream.url || '')).slice(0, 250).map(stream => ({url: stream.url, name: String(stream.name || '').slice(0, 200), quality: String(stream.quality || '').slice(0, 30), language: String(stream.language || '').slice(0, 30), voice: String(stream.voice || '').slice(0, 100), season: Number(stream.season) || undefined, episode: Number(stream.episode) || undefined}))};
        }
        fail(404, 'Не знайдено');
    }
    return {
        async fetch(request, env) {
            const origin = request.headers.get('origin');
            const headers = {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'vary': 'Origin'};
            if (origin === env.APP_ORIGIN) { headers['access-control-allow-origin'] = origin; headers['access-control-allow-methods'] = 'GET,POST,PUT,OPTIONS'; headers['access-control-allow-headers'] = 'Content-Type,Authorization'; }
            if (request.method === 'OPTIONS') return new Response(null, {status: origin === env.APP_ORIGIN ? 204 : 403, headers});
            try { return new Response(JSON.stringify(await handle(request, env)), {headers}); }
            catch (error) { return new Response(JSON.stringify({error: error.status ? error.message : 'Сервіс тимчасово недоступний'}), {status: error.status || 503, headers}); }
        },
        async scheduled(_event, env) { await cleanup(env); }
    };
}
export default createService();
