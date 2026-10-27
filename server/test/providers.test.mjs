import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProviders} from '../providers.mjs';
async function call(handler, path, data) { const response = await handler(new Request('https://test/api/providers/' + path, {method: data ? 'POST' : 'GET', headers: {'content-type': 'application/json'}, body: data ? JSON.stringify(data) : undefined})); return {status: response.status, data: await response.json()}; }
test('Filmix search maps titles and guest streams only use advertised permitted qualities', async () => {
    const handler = createProviders(async url => String(url).includes('/search?') ? Response.json([{id: 1113, title: '<b>Матриця</b>', original_title: 'The Matrix', year: 1999}]) : Response.json({player_links: {movie: [{translation: 'Українська', link: 'https://media.example/movie_[480,720,1080].mp4'}]}}));
    const search = await call(handler, 'filmix/search?query=The%20Matrix');
    assert.equal(search.data.items[0].title, 'Матриця');
    const result = await call(handler, 'filmix/streams', {id: '1113'});
    assert.equal(result.data.streams.length, 1); assert.equal(result.data.streams[0].url, 'https://media.example/movie_480.mp4');
    assert.equal(result.data.streams[0].voice, 'Українська');
});
test('source restrictions and ad flags never become playable URLs', async () => {
    const handler = createProviders(async () => Response.json({player_links: {movie: [{translation: 'Заблокировано правообладателем!', link: 'https://media.example/abuse_[480,720].mp4'}, {translation: 'main', link: 'https://media.example/movie.m3u8?isWithVideoAds=1'}]}}));
    const result = await call(handler, 'filmix/streams', {id: '2'});
    assert.equal(result.data.streams.length, 0); assert.equal(result.data.status, 'restricted');
});
test('provider routes cannot fetch user-supplied hosts and surface upstream failures', async () => {
    let calls = 0;
    const handler = createProviders(async () => { calls++; return new Response('not allowed', {status: 405}); });
    assert.equal((await call(handler, 'https://evil.example/')).status, 404);
    assert.equal((await call(handler, 'rezka/details', {id: 'https://evil.example/movie.html'})).status, 400);
    assert.equal(calls, 0);
    const failed = await call(handler, 'rezka/search?query=Matrix'); assert.equal(failed.status, 502); assert.match(failed.data.error, /405/);
});
test('anti-bot challenges are reported without retrying or switching identities', async () => {
    let count = 0; const handler = createProviders(async () => { count++; return new Response('<script id="anubis_challenge"></script>'); });
    const result = await call(handler, 'rezka/search?query=Matrix'); assert.equal(result.status, 503); assert.equal(count, 1);
});
test('AniLiberty uses supported no-ad preferences without changing authorization', async () => {
    const called = [];
    const handler = createProviders(async url => {
        called.push(String(url));
        if (String(url).includes('/anime/releases/')) return Response.json({type: {value: 'TV'}, episodes: [{ordinal: 1, hls_720: 'https://cache.libria.fun/video.m3u8?isAuthorized=0&isWithVideoAds=1&isWithVideoAdsAlways=1'}]});
        return new Response('#EXTM3U\n#EXTINF:10,\nsegment.ts\n');
    });
    const result = await call(handler, 'aniliberty/streams', {id: '413'});
    assert.equal(result.data.streams.length, 1);
    const stream = new URL(result.data.streams[0].url);
    assert.equal(stream.searchParams.get('isAuthorized'), '0');
    assert.equal(stream.searchParams.get('isWithVideoAds'), '0');
    assert.equal(stream.searchParams.get('isWithVideoAdsAlways'), '0');
    assert.equal(called.length, 2);
});
test('AniLiberty refuses geo/copyright blocks and playlists containing ad markers', async () => {
    const blocked = createProviders(async () => Response.json({is_blocked_by_geo: true}));
    assert.equal((await call(blocked, 'aniliberty/streams', {id: '413'})).data.status, 'restricted');
    const advertised = createProviders(async url => String(url).includes('/anime/releases/') ? Response.json({type: {value: 'TV'}, episodes: [{ordinal: 1, hls_720: 'https://cache.libria.fun/video.m3u8'}]}) : new Response('#EXTM3U\n#EXT-X-CUE-OUT:30\n/ads/segment.ts'));
    const result = await call(advertised, 'aniliberty/streams', {id: '413'});
    assert.equal(result.data.status, 'ads_required'); assert.equal(result.data.streams.length, 0);
});
