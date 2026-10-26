import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createService} from '../worker.mjs';
function fixture() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readFileSync(new URL('../migrations/0001.sql', import.meta.url), 'utf8'));
    function prepared(sql, values = []) { return {bind(...bound) { return prepared(sql, bound); }, async first() { return sqlite.prepare(sql).get(...values) || null; }, async run() { return {meta: {changes: Number(sqlite.prepare(sql).run(...values).changes)}}; }}; }
    const DB = {prepare: sql => prepared(sql), async batch(items) { sqlite.exec('BEGIN'); try { const result = []; for (const item of items) result.push(await item.run()); sqlite.exec('COMMIT'); return result; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } }};
    const messages = [];
    const service = createService(async (url, init) => {
        if (String(url).startsWith('https://catalog.example/')) return Response.json({items: [{tmdb_id: 1, streams: [{url: 'https://media.example/movie.mp4', voice: 'Українська'}, {url: 'javascript:alert(1)'}]}]});
        messages.push({url, data: JSON.parse(init.body)}); return Response.json({ok: true, result: true});
    });
    const env = {DB, APP_ORIGIN: 'https://xott69.github.io', BOT_USERNAME: 'XottTestBot', BOT_TOKEN: 'test-token', TELEGRAM_WEBHOOK_SECRET: 'test-webhook', CATALOG_URL: 'https://catalog.example/feed.json'};
    async function request(path, {method = 'GET', data, token, origin = env.APP_ORIGIN, webhook = false} = {}) {
        const headers = {'content-type': 'application/json'};
        if (origin) headers.origin = origin;
        if (token) headers.authorization = 'Bearer ' + token;
        if (webhook) headers['X-Telegram-Bot-Api-Secret-Token'] = env.TELEGRAM_WEBHOOK_SECRET;
        const response = await service.fetch(new Request('https://api.example' + path, {method, headers, body: data ? JSON.stringify(data) : undefined}), env);
        return {status: response.status, headers: response.headers, data: response.status === 204 ? null : await response.json()};
    }
    async function login(uid = 111) {
        const start = await request('/api/login/start', {method: 'POST', data: {device: 'Hisense 32A4N'}});
        assert.equal(start.status, 200);
        const pending = start.data;
        await request('/telegram', {method: 'POST', webhook: true, data: {message: {chat: {id: uid, type: 'private'}, from: {id: uid}, text: '/start login_' + pending.code}}});
        await request('/telegram', {method: 'POST', webhook: true, data: {callback_query: {id: 'callback', from: {id: uid, first_name: 'Антон'}, data: 'approve:' + pending.id}}});
        const poll = await request('/api/login/poll', {method: 'POST', data: {id: pending.id, poll_token: pending.poll_token}});
        assert.equal(poll.data.status, 'approved'); return {token: poll.data.token, pending};
    }
    return {request, login, messages, sqlite, env};
}
test('Telegram code requires explicit confirmation; one-time redeem; sessions contain no plain token', async () => {
    const {request, messages, sqlite} = fixture();
    const {data: pending} = await request('/api/login/start', {method: 'POST', data: {device: 'Hisense'}});
    assert.equal((await request('/api/login/poll', {method: 'POST', data: {id: pending.id, poll_token: pending.poll_token}})).data.status, 'pending');
    assert.equal((await request('/api/login/poll', {method: 'POST', data: {id: pending.id, poll_token: 'a'.repeat(64)}})).status, 403);
    assert.equal((await request('/telegram', {method: 'POST', data: {}})).status, 403);
    await request('/telegram', {method: 'POST', webhook: true, data: {message: {chat: {type: 'private'}, from: {id: 7}, text: '/start login_' + pending.code}}});
    assert.equal((await request('/api/login/poll', {method: 'POST', data: {id: pending.id, poll_token: pending.poll_token}})).data.status, 'pending');
    assert.match(messages.at(-1).data.reply_markup.inline_keyboard[0][0].callback_data, /^approve:/);
    await request('/telegram', {method: 'POST', webhook: true, data: {callback_query: {id: 'wrong', from: {id: 8}, data: 'approve:' + pending.id}}});
    assert.equal(sqlite.prepare('SELECT approved FROM logins').get().approved, 0);
    await request('/telegram', {method: 'POST', webhook: true, data: {callback_query: {id: 'right', from: {id: 7, first_name: 'Антон'}, data: 'approve:' + pending.id}}});
    const result = await request('/api/login/poll', {method: 'POST', data: {id: pending.id, poll_token: pending.poll_token}});
    assert.equal(result.data.status, 'approved'); assert.notEqual(sqlite.prepare('SELECT token_hash FROM sessions').get().token_hash, result.data.token);
    assert.equal((await request('/api/login/poll', {method: 'POST', data: {id: pending.id, poll_token: pending.poll_token}})).status, 410);
});
test('sync is private, rejects stale writes and refuses token/settings uploads', async () => {
    const {request, login} = fixture(); const first = await login(1), second = await login(2);
    assert.equal((await request('/api/state')).status, 401);
    assert.equal((await request('/api/state', {method: 'PUT', token: first.token, data: {version: 0, data: {favorite: {book: [10]}, file_view: {a: {time: 15}}}}})).status, 200);
    assert.deepEqual((await request('/api/state', {token: second.token})).data.data, {});
    assert.equal((await request('/api/state', {method: 'PUT', token: first.token, data: {version: 0, data: {favorite: {}}}})).status, 409);
    assert.equal((await request('/api/state', {method: 'PUT', token: first.token, data: {version: 1, data: {plugins: ['secret']}}})).status, 400);
    assert.equal((await request('/api/state', {token: first.token, origin: 'https://evil.example'})).status, 403);
    assert.equal((await request('/api/me', {token: first.token})).data.name, 'Антон');
    await request('/api/logout', {method: 'POST', token: first.token, data: {}});
    assert.equal((await request('/api/me', {token: first.token})).status, 401);
});
test('expired codes, rate limits, global logout and stream validation', async () => {
    const f = fixture(), a = await f.login();
    const sources = await f.request('/api/sources?tmdb_id=1&type=movie', {token: a.token});
    assert.equal(sources.data.streams.length, 1); assert.equal(sources.data.streams[0].voice, 'Українська');
    const pending = (await f.request('/api/login/start', {method: 'POST', data: {}})).data;
    f.sqlite.prepare('UPDATE logins SET expires_at=0 WHERE id=?').run(pending.id);
    assert.equal((await f.request('/api/login/poll', {method: 'POST', data: {id: pending.id, poll_token: pending.poll_token}})).status, 410);
    await f.request('/telegram', {method: 'POST', webhook: true, data: {message: {chat: {type: 'private'}, from: {id: 111}, text: '/logoutall'}}});
    assert.equal((await f.request('/api/me', {token: a.token})).status, 401);
    let last; for (let i = 0; i < 12; i++) last = await f.request('/api/login/start', {method: 'POST', data: {}});
    assert.equal(last.status, 429);
});
