/* XOTT Sources v2.0.0 — direct media only; no embeds, popups or ad SDKs. */
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
    function archive(card) {
        var name = card.original_title || card.original_name || title(card);
        var escaped = name.replace(/["\\]/g, ' ');
        var query = 'title:("' + escaped + '") AND mediatype:movies';
        notify('Шукаємо у відкритому архіві…');
        get('https://archive.org/advancedsearch.php?q=' + encodeURIComponent(query) + '&fl[]=identifier&fl[]=title&fl[]=year&rows=25&output=json', function (error, result) {
            if (error) return notify(error.message);
            var rows = ((result || {}).response || {}).docs || [];
            choose(rows.map(function (row) { return {title: row.title, subtitle: 'Internet Archive · ' + (row.year || '') + ' · перевірте назву та рік', id: row.identifier}; }), 'Результати архіву · ' + name, function (item) {
                get('https://archive.org/metadata/' + encodeURIComponent(item.id), function (fileError, info) {
                    if (fileError) return notify(fileError.message);
                    if (info.is_dark || info.metadata && info.metadata.is_restricted) return notify('Файл обмежений власником архіву');
                    var files = (info.files || []).filter(function (file) { return /\.mp4$/i.test(file.name || '') && file.source && !/thumb|sample|trailer/i.test(file.name); });
                    streams(card, files.map(function (file) { return {name: file.name, quality: file.height ? file.height + 'p' : '', url: 'https://archive.org/download/' + encodeURIComponent(item.id) + '/' + file.name.split('/').map(encodeURIComponent).join('/')}; }), item.title);
                });
            });
        });
    }
    function commons(card) {
        notify('Шукаємо відеоматеріали Wikimedia…');
        get('https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrsearch=' + encodeURIComponent(title(card) + ' filetype:video') + '&gsrlimit=15&prop=videoinfo&viprop=url%7Cderivatives', function (error, data) {
            if (error) return notify(error.message);
            var entries = [], pages = data.query && data.query.pages || {};
            Object.keys(pages).forEach(function (key) { var page = pages[key], video = page.videoinfo && page.videoinfo[0]; if (video) { var derivative = (video.derivatives || []).filter(function (entry) { return playable(entry.src) && /webm/i.test(entry.type || entry.src); })[0]; var url = derivative ? derivative.src : video.url; if (playable(url)) entries.push({name: page.title.replace(/^File:/, ''), url: url}); } });
            streams(card, entries, 'Wikimedia · матеріали, можуть бути уривками');
        });
    }
    function open(card) {
        choose([{title: 'Власний каталог', subtitle: 'Озвучки, якість і серії з вашого JSON-каталогу', source: catalog}, {title: 'Internet Archive', subtitle: 'Відкриті архівні відео; назву та рік потрібно звіряти', source: archive}, {title: 'Wikimedia Commons', subtitle: 'Вільні відеоматеріали та уривки', source: commons}], 'XOTT Sources · ' + title(card), function (item) { item.source(card); });
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
        Lampa.SettingsApi.addParam({component: 'xott_sources', param: {type: 'button'}, field: {name: 'Перевірити плеєр · Big Buck Bunny', description: 'Відкритий демонстраційний MP4 без діалогів'}, onRender: function (item) { item.on('hover:enter', function () { play({id: 12690, title: 'Big Buck Bunny', original_title: 'Big Buck Bunny'}, {url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'}); }); }});
        Lampa.SettingsApi.addParam({component: 'xott_sources', param: {name: 'xott_catalog_url', type: 'input', values: '', default: ''}, field: {name: 'URL власного каталогу', description: 'HTTPS JSON-каталог із прямими відеопотоками. Потрібен дозвіл CORS.'}});
    }
    window.XottSources = {open: open, play: play, playable: playable};
    if (window.appready) ready(); else Lampa.Listener.follow('app', function (event) { if (event.type === 'ready') ready(); });
})();
