/* XOTT Sources v2.2.0 — direct media only; no embeds, popups or ad SDKs. */
(function () {
    'use strict';
    if (window.XOTT_SOURCES_V2) return;
    window.XOTT_SOURCES_V2 = true;
    function title(card) { return card.title || card.name || card.original_title || card.original_name || ''; }
    function notify(message) { Lampa.Noty.show(message); }
    function choose(items, label, callback) {
        if (!items.length) return notify('Доступних відео не знайдено');
        Lampa.Select.show({title: label, items: items, onBack: function () { Lampa.Controller.toggle('content'); }, onSelect: function (item) { Lampa.Controller.toggle('content'); callback(item); }});
    }
    function get(url, callback) {
        var xhr = new XMLHttpRequest(), done = false;
        function finish(error, data) { if (!done) { done = true; callback(error, data); } }
        xhr.open('GET', url, true); xhr.timeout = 18000;
        xhr.onload = function () { if (xhr.status < 200 || xhr.status >= 300) return finish(new Error('HTTP ' + xhr.status)); try { finish(null, JSON.parse(xhr.responseText)); } catch (_) { finish(new Error('Некоректна відповідь джерела')); } };
        xhr.onerror = function () { finish(new Error('Джерело недоступне або не дозволяє CORS')); };
        xhr.ontimeout = function () { finish(new Error('Джерело не відповіло вчасно')); }; xhr.send();
    }
    function playable(url) { return /^https:\/\//i.test(url || '') && /\.(mp4|m3u8|webm)(?:[?#]|$)/i.test(url); }
    function play(card, stream, playlist) {
        if (!playable(stream.url)) return notify('Потрібне пряме HTTPS-посилання MP4, HLS або WebM');
        var label = title(card) + (stream.episode ? ' · S' + (stream.season || 1) + 'E' + stream.episode : '');
        var meta = Lampa.Timeline.link(card, stream.season, stream.episode);
        var hash = Lampa.Utils.hash('xott:' + (card.id || title(card)) + ':' + (stream.season || 0) + ':' + (stream.episode || 0));
        var data = {url: stream.url, title: label, timeline: Lampa.Timeline.view(hash, meta)};
        Lampa.Favorite.add('history', card);
        Lampa.Player.play(data);
        if (playlist) Lampa.Player.playlist(playlist.filter(function (entry) { return playable(entry.url); }).map(function (entry) { return {title: title(card) + ' · ' + (entry.name || entry.quality || 'Відео'), url: entry.url}; }));
    }
    function streams(card, entries, label) {
        var list = (entries || []).filter(function (entry) { return playable(entry.url); });
        choose(list.map(function (entry) { return {title: (entry.season ? 'S' + entry.season + ' ' : '') + (entry.episode ? 'E' + entry.episode + ' · ' : '') + (entry.name || entry.quality || 'Авто'), subtitle: [entry.voice, entry.language, entry.quality].filter(Boolean).join(' · '), stream: entry}; }), label, function (item) { play(card, item.stream); });
    }
    function catalog(card) {
        var api = window.XottAccount;
        if (api && api.user() && window.XOTT_CONFIG && window.XOTT_CONFIG.api) {
            return api.request('/api/sources?tmdb_id=' + encodeURIComponent(card.id || '') + '&type=' + (card.first_air_date || card.original_name ? 'tv' : 'movie'), 'GET', null, function (error, data) {
                if (error) return notify(error.message);
                if (!data.configured) return notify('Серверний каталог ще не підключений');
                streams(card, data.streams, 'Власний каталог · ' + title(card));
            });
        }
        var url = Lampa.Storage.get('xott_catalog_url', '') || (window.XOTT_CONFIG && window.XOTT_CONFIG.catalog) || '';
        if (!/^https:\/\//i.test(url)) return notify('Власний каталог ще не підключений. Додайте його URL у налаштуваннях XOTT Sources.');
        get(url, function (error, feed) {
            if (error) return notify(error.message);
            var kind = card.first_air_date || card.original_name ? 'tv' : 'movie';
            var found = (feed.items || []).filter(function (entry) { return String(entry.tmdb_id) === String(card.id) && (entry.type || 'movie') === kind; });
            var list = []; found.forEach(function (entry) { list = list.concat(entry.streams || []); });
            streams(card, list, 'Власний каталог · ' + title(card));
        });
    }
    function sourceRequest(provider, action, data, callback) {
        var base = Lampa.Storage.get('xott_provider_api', '') || (window.XOTT_CONFIG && window.XOTT_CONFIG.providers) || '';
        if (!base) return callback(new Error('Сервер джерел ще не підключений. Вкажіть адресу в налаштуваннях XOTT Sources.'));
        if (base.charAt(0) === '/') base = location.origin + base;
        if (!/^https:\/\//i.test(base) && base.indexOf(location.origin + '/') !== 0) return callback(new Error('Адреса сервера джерел має починатися з HTTPS'));
        var url = base.replace(/\/$/, '') + '/' + provider + '/' + action;
        var xhr = new XMLHttpRequest(), done = false;
        function finish(error, result) { if (!done) { done = true; callback(error, result); } }
        xhr.open(data ? 'POST' : 'GET', url, true); xhr.timeout = 25000;
        if (data) xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.onload = function () { var result; try { result = JSON.parse(xhr.responseText); } catch (_) { return finish(new Error('Сервер джерел повернув некоректну відповідь')); } if (xhr.status < 200 || xhr.status >= 300) return finish(new Error(result.error || 'Джерело недоступне')); finish(null, result); };
        xhr.onerror = function () { finish(new Error('Сервер джерел недоступний або не дозволяє CORS')); };
        xhr.ontimeout = function () { finish(new Error('Джерело не відповіло вчасно')); }; xhr.send(data ? JSON.stringify(data) : null);
    }
    function normalize(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9\u0400-\u04ff]/g, ''); }
    function lookup(card, provider) {
        var name = card.original_title || card.original_name || title(card);
        var label = provider === 'filmix' ? 'Filmix' : provider === 'aniliberty' ? 'AniLiberty' : 'HDRezka';
        notify('Шукаємо у ' + label + '…');
        sourceRequest(provider, 'search?query=' + encodeURIComponent(name), null, function (error, result) {
            if (error) return notify(error.message);
            var rows = result.items || [];
            var year = Number(String(card.release_date || card.first_air_date || '').slice(0, 4));
            var exact = rows.filter(function (item) { return [item.title, item.original_title].some(function (candidate) { return normalize(candidate) === normalize(name) || normalize(candidate) === normalize(title(card)); }) && (!year || !item.year || item.year === year); });
            if (exact.length === 1) return found(exact[0]);
            choose(rows.map(function (item) { return {title: item.title + (item.year ? ' (' + item.year + ')' : ''), subtitle: item.original_title || '', result: item}; }), 'Результати ' + label, function (item) { found(item.result); });
            function found(item) {
                sourceRequest(provider, provider === 'rezka' ? 'details' : 'streams', {id: item.id}, function (loadError, details) {
                    if (loadError) return notify(loadError.message);
                    if (provider !== 'rezka') {
                        if (!details.streams || !details.streams.length) return notify(details.message || 'Це відео недоступне в гостьовому режимі');
                        return pickEpisodes(card, details.streams, label);
                    }
                    choose((details.voices || []).map(function (voice) { return {title: voice.title, voice: voice}; }), 'HDRezka · озвучка', function (selected) {
                        var params = {id: details.id, voice: selected.voice.id, is_camrip: selected.voice.is_camrip, is_director: selected.voice.is_director, series: details.series, season: details.default_season, episode: details.default_episode};
                        function load() { sourceRequest('rezka', 'streams', params, function (streamError, response) { if (streamError) return notify(streamError.message); if (!response.streams || !response.streams.length) return notify(response.message || 'Джерело не надало відео'); pickEpisodes(card, response.streams, 'HDRezka'); }); }
                        if (details.series) return notify('Серіали HDRezka поки не підтримуються цим адаптером. Спробуйте Filmix.');
                        load();
                    });
                    if (!details.voices || !details.voices.length) notify(details.message || 'Доступних озвучок немає');
                });
            }
        });
    }
    function pickEpisodes(card, list, label) {
        var seasons = [];
        list.forEach(function (entry) { if (entry.season && seasons.indexOf(entry.season) < 0) seasons.push(entry.season); });
        if (!seasons.length) return pickVoice(list);
        seasons.sort(function (a, b) { return a - b; });
        choose(seasons.map(function (n) { return {title: 'Сезон ' + n, number: n}; }), label + ' · сезон', function (season) {
            var selected = list.filter(function (entry) { return entry.season === season.number; }), episodes = [];
            selected.forEach(function (entry) { if (episodes.indexOf(entry.episode) < 0) episodes.push(entry.episode); });
            episodes.sort(function (a, b) { return a - b; });
            choose(episodes.map(function (n) { return {title: 'Серія ' + n, number: n}; }), label + ' · серія', function (episode) { pickVoice(selected.filter(function (entry) { return entry.episode === episode.number; })); });
        });
        function pickVoice(entries) {
            var voices = [];
            entries.forEach(function (entry) { var voice = entry.voice || 'Основна озвучка'; if (voices.indexOf(voice) < 0) voices.push(voice); });
            voices.sort(function (a, b) { return Number(/укр|ukrain|\bua\b/i.test(b)) - Number(/укр|ukrain|\bua\b/i.test(a)); });
            if (voices.length < 2) return streams(card, entries, label + ' · якість');
            choose(voices.map(function (voice) { return {title: voice, voice: voice}; }), label + ' · озвучка', function (selected) { streams(card, entries.filter(function (entry) { return (entry.voice || 'Основна озвучка') === selected.voice; }), label + ' · якість'); });
        }
    }
    function open(card) {
        var choices = [{title: 'Filmix', subtitle: 'Автоматичний пошук · гостьовий доступ до 480p', source: function () { lookup(card, 'filmix'); }}, {title: 'AniLiberty', subtitle: 'Аніме · озвучка джерела · абсолютні номери серій', source: function () { lookup(card, 'aniliberty'); }}];
        if (Lampa.Storage.get('xott_catalog_url', '') || window.XOTT_CONFIG && window.XOTT_CONFIG.catalog) choices.push({title: 'Власний каталог', subtitle: 'Ваші прямі відеопотоки', source: function () { catalog(card); }});
        choose(choices, 'XOTT Sources · ' + title(card), function (item) { item.source(); });
    }
    function inject(event) {
        if (!event || ['complite', 'complete'].indexOf(event.type) < 0) return;
        var card = event.data && event.data.movie || event.object && event.object.card;
        var root = event.body || event.object && event.object.activity && event.object.activity.render();
        if (!card || !root || !root.find) return;
        var buttons = root.find('.full-start-new__buttons').first();
        if (!buttons.length) buttons = root.find('.full-start__buttons').first();
        if (!buttons.length || buttons.find('.xott-sources-button').length) return;
        var button = $('<div class="full-start__button selector xott-sources-button"><span>▶ Дивитися · XOTT</span></div>');
        button.on('hover:enter', function () { open(card); }); buttons.prepend(button);
    }
    function ready() {
        Lampa.Listener.follow('full', inject);
        Lampa.SettingsApi.addComponent({component: 'xott_sources', name: 'XOTT Sources', icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>'});
        Lampa.SettingsApi.addParam({component: 'xott_sources', param: {name: 'xott_provider_api', type: 'input', values: '', default: ''}, field: {name: 'Сервер джерел', description: 'HTTPS-адреса API джерел. На нашому сервері налаштовано автоматично.'}});
        Lampa.SettingsApi.addParam({component: 'xott_sources', param: {name: 'xott_catalog_url', type: 'input', values: '', default: ''}, field: {name: 'URL власного каталогу', description: 'HTTPS JSON-каталог із прямими відеопотоками. Потрібен дозвіл CORS.'}});
    }
    window.XottSources = {open: open, play: play, playable: playable};
    if (window.appready) ready(); else Lampa.Listener.follow('app', function (event) { if (event.type === 'ready') ready(); });
})();
