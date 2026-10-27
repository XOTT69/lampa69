/* Independent guest-source adapters. No open proxy, ad SDK or iframe playback. */
export const providerList = [
    {id: 'filmix', name: 'Filmix', access: 'guest', note: 'Гостьовий доступ до 480p; частина відео може бути недоступна'},
    {id: 'rezka', name: 'HDRezka', access: 'guest', note: 'Залежить від доступності сайту; захищені відео не відкриваються'}
];
const MAX_BODY = 1024 * 1024 * 3;
class SourceError extends Error { constructor(status, message) { super(message); this.status = status; } }
const textOnly = text => String(text || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();
const isMedia = value => /^https:\/\//i.test(value || '') && /\.(mp4|m3u8|webm)(?:[?#]|$)/i.test(value) && !/\/abuse_|isWithVideoAds=1|preroll|advert|trailer/i.test(value);
const attr = (html, name) => html.match(new RegExp('\\b' + name + '=["\']([^"\']*)["\']', 'i'))?.[1] || '';
const query = value => String(value || '').trim().slice(0, 150);
export function createProviders(fetchImpl = fetch) {
    async function read(url, options = {}) {
        const response = await fetchImpl(url, {...options, signal: AbortSignal.timeout(15000), redirect: 'manual'});
        if (response.status >= 300 && response.status < 400) throw new SourceError(502, 'Джерело змінило адресу; адаптер потребує оновлення');
        if (!response.ok) throw new SourceError(502, 'Джерело відповіло HTTP ' + response.status);
        const reader = response.body.getReader(); let total = 0, chunks = [];
        while (true) { const item = await reader.read(); if (item.done) break; total += item.value.length; if (total > MAX_BODY) { await reader.cancel(); throw new SourceError(502, 'Завелика відповідь джерела'); } chunks.push(item.value); }
        const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        const body = new TextDecoder().decode(bytes);
        if (/cf-chl-|anubis_challenge|<title>Just a moment|Verify you are human/i.test(body)) throw new SourceError(503, 'Джерело вимагає перевірки браузера; автоматичний доступ недоступний');
        return body;
    }
    async function json(url, options) { try { return JSON.parse(await read(url, options)); } catch (error) { if (error.status) throw error; throw new SourceError(502, 'Джерело повернуло некоректні дані'); } }
    function filmixURL(path) {
        const url = new URL('http://filmixapp.cyou/api/v2/' + path);
        const guest = {user_dev_id: '584f545454563230', user_dev_name: 'Xiaomi', user_dev_token: 'aaaabbbbccccddddeeeeffffaaaabbbb', user_dev_vendor: 'Xiaomi', user_dev_os: '14', user_dev_apk: '2.2.0', app_lang: 'ru-rRU'};
        for (const [key, value] of Object.entries(guest)) url.searchParams.set(key, value);
        return url;
    }
    async function filmixSearch(term) {
        const url = filmixURL('search'); url.searchParams.set('story', term);
        const list = await json(url.href, {headers: {'User-Agent': 'okhttp/3.10.0', accept: 'application/json'}});
        if (!Array.isArray(list)) throw new SourceError(502, 'Пошук Filmix недоступний');
        return {provider: 'filmix', items: list.slice(0, 50).map(item => ({id: String(item.id), title: textOnly(item.title), original_title: textOnly(item.original_title), year: Number(item.year) || null, type: item.serial_stats ? 'tv' : 'movie'}))};
    }
    async function filmixStreams(id) {
        if (!/^\d{1,10}$/.test(String(id))) throw new SourceError(400, 'Некоректний ID');
        const data = await json(filmixURL('post/' + id).href, {headers: {'User-Agent': 'okhttp/3.10.0', accept: 'application/json'}});
        const streams = []; let blocked = false;
        function append(file, season, episode, voice) {
            if (!file || typeof file !== 'object') return;
            const link = String(file.link || '');
            if (/заблок|правооблад|blocked/i.test(file.translation || '') || /\/abuse_/i.test(link)) { blocked = true; return; }
            const advertised = link.match(/\[([\d,]+)\](\.mp4)/i);
            let qualities = advertised ? advertised[1].split(',').map(Number) : Array.isArray(file.qualities) ? file.qualities.map(Number) : [480];
            qualities = [...new Set(qualities)].filter(q => q > 0 && q <= 480);
            for (const quality of qualities) {
                const url = advertised ? link.replace(advertised[0], quality + advertised[2]) : link.replace('%s', String(quality));
                if (isMedia(url)) streams.push({url, quality: quality + 'p', voice: textOnly(file.translation || voice || ''), season: Number(season) || undefined, episode: Number(episode) || undefined});
            }
        }
        for (const file of Object.values(data.player_links?.movie || {})) append(file);
        for (const [season, voices] of Object.entries(data.player_links?.playlist || {})) {
            for (const [voice, episodes] of Object.entries(voices || {})) {
                for (const [episode, file] of Object.entries(episodes || {})) append(file, season, episode, voice);
            }
        }
        return {provider: 'filmix', streams: streams.slice(0, 300), status: streams.length ? 'ready' : blocked ? 'restricted' : 'empty', message: blocked && !streams.length ? 'Filmix обмежив це відео. Обмеження джерела не обходяться.' : !streams.length ? 'Гостьових відеопотоків для цього результату немає' : ''};
    }
    const rezkaHeaders = {accept: 'text/html,application/json', 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://rezka.ag/'};
    async function rezkaSearch(term) {
        const html = await read('https://rezka.ag/engine/ajax/search.php', {method: 'POST', headers: {...rezkaHeaders, 'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({q: term})});
        const items = [], seen = new Set();
        for (const match of html.matchAll(/<a\b[^>]*href=["'](https:\/\/rezka\.ag\/[^"']+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
            const url = new URL(match[1]); if (seen.has(url.pathname)) continue; seen.add(url.pathname);
            const text = textOnly(match[2]); const year = text.match(/\b(19\d{2}|20\d{2})\b/);
            items.push({id: url.pathname, title: text, year: year ? Number(year[1]) : null});
        }
        return {provider: 'rezka', items: items.slice(0, 40)};
    }
    async function rezkaDetails(path) {
        if (!/^\/(?:films|series|animation|cartoons)\/[\w\-/]+\.html$/.test(path || '')) throw new SourceError(400, 'Некоректна картка HDRezka');
        const html = await read('https://rezka.ag' + path, {headers: rezkaHeaders});
        const movie = html.match(/\.initCDNMoviesEvents\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        const series = html.match(/\.initCDNSeriesEvents\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (!movie && !series) return {provider: 'rezka', voices: [], message: 'Відео недоступне без входу або сторінка змінилася'};
        const data = movie || series, voices = [];
        const list = html.match(/<ul\b[^>]*id=["']translators-list["'][^>]*>([\s\S]*?)<\/ul>/i)?.[1] || '';
        for (const item of list.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)) {
            const id = attr(item[1], 'data-translator_id'); if (!/^\d+$/.test(id) || attr(item[1], 'data-ads') === '1') continue;
            voices.push({id, title: textOnly(attr(item[1], 'title') || item[2]), is_camrip: attr(item[1], 'data-camrip') || '0', is_director: attr(item[1], 'data-director') || '0'});
        }
        if (!voices.length && (!movie || movie[4] === '0')) voices.push({id: data[2], title: 'Основна озвучка', is_camrip: movie?.[3] || '0', is_director: movie?.[5] || '0'});
        return {provider: 'rezka', id: data[1], series: !!series, voices, default_season: Number(series?.[3]) || 1, default_episode: Number(series?.[4]) || 1};
    }
    function decode(value) {
        if (!String(value).startsWith('#')) return String(value);
        let text = String(value).slice(2);
        for (const marker of ['$$!!@$$@^!@#$$@', '@@@@@!##!^^^', '####^!!##!@@', '^^^!@##!!##', '$$#!!@#!@##']) text = text.split('//_//' + btoa(marker)).join('');
        try { return new TextDecoder().decode(Uint8Array.from(atob(text), c => c.charCodeAt(0))); } catch { return ''; }
    }
    async function rezkaStreams(input) {
        if (!/^\d{1,10}$/.test(String(input.id)) || !/^\d{1,10}$/.test(String(input.voice))) throw new SourceError(400, 'Некоректний вибір озвучки');
        const params = new URLSearchParams({id: input.id, translator_id: input.voice, action: input.series ? 'get_stream' : 'get_movie'});
        if (input.series) { params.set('season', String(Math.max(1, Math.min(1000, Number(input.season) || 1)))); params.set('episode', String(Math.max(1, Math.min(10000, Number(input.episode) || 1)))); }
        else { params.set('is_camrip', input.is_camrip === '1' ? '1' : '0'); params.set('is_ads', '0'); params.set('is_director', input.is_director === '1' ? '1' : '0'); }
        const result = await json('https://rezka.ag/ajax/get_cdn_series/', {method: 'POST', headers: {...rezkaHeaders, 'Content-Type': 'application/x-www-form-urlencoded'}, body: params});
        if (result.premium_content || !result.success || !result.url) return {provider: 'rezka', streams: [], status: 'restricted', message: 'Джерело не надало доступний гостьовий потік'};
        const decoded = decode(result.url), streams = [];
        for (const entry of decoded.matchAll(/\[([^\]]+)\]([^\[]+)/g)) {
            for (const url of entry[2].split(/\s+or\s+|,/).map(value => value.trim())) {
                if (isMedia(url)) { streams.push({url, quality: entry[1], season: input.series ? Number(input.season) : undefined, episode: input.series ? Number(input.episode) : undefined}); break; }
            }
        }
        return {provider: 'rezka', streams, status: streams.length ? 'ready' : 'empty'};
    }
    return async function handle(request) {
        const headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};
        try {
            const url = new URL(request.url), route = url.pathname.replace(/^\/api\/providers\/?/, '');
            if (request.method === 'GET' && !route) return Response.json({providers: providerList}, {headers});
            if (!['GET', 'POST'].includes(request.method)) throw new SourceError(405, 'Метод не підтримується');
            let input = {};
            if (request.method === 'POST') { const text = await request.text(); if (text.length > 4096) throw new SourceError(413, 'Завеликий запит'); try { input = JSON.parse(text); } catch { throw new SourceError(400, 'Некоректний JSON'); } }
            const term = query(url.searchParams.get('query'));
            if (route.endsWith('/search') && term.length < 2) throw new SourceError(400, 'Введіть щонайменше дві літери');
            let result;
            if (route === 'filmix/search' && request.method === 'GET') result = await filmixSearch(term);
            else if (route === 'filmix/streams' && request.method === 'POST') result = await filmixStreams(input.id);
            else if (route === 'rezka/search' && request.method === 'GET') result = await rezkaSearch(term);
            else if (route === 'rezka/details' && request.method === 'POST') result = await rezkaDetails(input.id);
            else if (route === 'rezka/streams' && request.method === 'POST') result = await rezkaStreams(input);
            else throw new SourceError(404, 'Джерело не знайдене');
            return Response.json(result, {headers});
        } catch (error) { return Response.json({error: error.status ? error.message : 'Джерело зараз недоступне'}, {status: error.status || 502, headers}); }
    };
}
