/* XOTT Online — Lampa MX plugin, v0.5.0
 * Free, public-domain/open-license video source: Internet Archive.
 * No stream piracy or embedded third-party scraper. 
 */
(function () {
  'use strict';
  if (window.XOTT_ONLINE_V02) return;
  window.XOTT_ONLINE_V02 = true;

  var API = 'https://archive.org';
  var BUTTON_CLASS = 'xott-online-button';
  var lastCard = null;

  function toast(message) {
    if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show(message);
    else console.log('[XOTT Online]', message);
  }

  function nameOf(card) {
    return (card && (card.title || card.name || card.original_title || card.original_name)) || '';
  }

  function pick(options, title, callback) {
    if (!options.length) return toast('Немає доступних варіантів');
    Lampa.Select.show({
      title: title,
      items: options,
      onBack: function () { Lampa.Controller.toggle('content'); },
      onSelect: function (value) {
        Lampa.Controller.toggle('content');
        callback(value);
      }
    });
  }

  function json(url, callback) {
    // Remote providers must permit cross-origin requests from Lampa.
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 15000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status < 200 || xhr.status >= 300) return callback(new Error('HTTP ' + xhr.status));
      try { callback(null, JSON.parse(xhr.responseText)); }
      catch (error) { callback(error); }
    };
    xhr.ontimeout = function () { callback(new Error('Timeout')); };
    xhr.onerror = function () { callback(new Error('Network/CORS')); };
    xhr.send();
  }

  function normalize(s) {
    return String(s || '').toLowerCase().replace(/[^\w\u0400-\u04ff ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function similarity(title, query) {
    var a = normalize(title), b = normalize(query);
    if (!a || !b) return 0;
    if (a === b) return 100;
    if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return 60;
    var tokens = b.split(' '), count = 0;
    tokens.forEach(function (w) { if (w.length > 2 && a.indexOf(w) !== -1) count++; });
    return Math.round(45 * count / (tokens.length || 1));
  }

  function searchArchive(card) {
    var title = nameOf(card);
    if (!title) return toast('Не вдалося визначити назву');
    toast('Шукаємо доступні відео...');
    var q = '(title:("' + title.replace(/["\\]/g, ' ') + '") OR title:(' + title.replace(/["\\]/g, ' ') + ')) AND mediatype:movies';
    var url = API + '/advancedsearch.php?q=' + encodeURIComponent(q) +
      '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=year&rows=35&page=1&output=json';
    json(url, function (err, response) {
      if (err) return toast('Помилка пошуку: ' + err.message);
      var docs = ((response || {}).response || {}).docs || [];
      var results = docs.filter(function (d) { return d.identifier && similarity(d.title, title) >= 30; })
        .sort(function (a, b) { return similarity(b.title, title) - similarity(a.title, title); });
      if (!results.length) return toast('У відкритому архіві цей фільм не знайдено');
      pick(results.slice(0, 25).map(function (d) {
        return {title: d.title + (d.year ? ' (' + d.year + ')' : ''), identifier: d.identifier, subtitle: 'Internet Archive'};
      }), 'Джерело: Internet Archive', function (entry) { loadFiles(entry, title); });
    });
  }

  function quality(file) {
    var size = parseInt(file.size, 10) || 0;
    var name = String(file.name || '');
    var match = name.match(/(2160|1080|720|480|360)p/i);
    if (match) return match[1] + 'p';
    if (/1920x1080/i.test(name)) return '1080p';
    if (/1280x720/i.test(name)) return '720p';
    return size ? Math.round(size / 1048576) + ' MB' : 'Авто';
  }

  function loadFiles(entry, title) {
    toast('Завантажуємо варіанти відео...');
    json(API + '/metadata/' + encodeURIComponent(entry.identifier), function (err, data) {
      if (err) return toast('Не вдалося отримати файли: ' + err.message);
      if (data.is_dark || data.is_collection || (data.metadata && data.metadata.is_restricted)) {
        return toast('Це відео недоступне для відтворення');
      }
      var files = (data.files || []).filter(function (f) {
        return f.name && (/\.(mp4|m4v|webm|ogv)$/i.test(f.name)) && !/thumb|sample|preview/i.test(f.name);
      });
      if (!files.length) return toast('Немає сумісних файлів для плеєра');
      // This source typically carries original audio; do not claim Ukrainian dubbing.
      pick([{title:'Оригінальна доріжка', files: files, subtitle: 'Мова залежить від відео'}],
        'Озвучка', function (choice) {
          pick(choice.files.map(function (f) {
            return {title: quality(f) + ' · ' + (f.format || 'Відео'), file: f};
          }), 'Якість', function (selected) {
            var stream = API + '/download/' + encodeURIComponent(entry.identifier) + '/' +
              selected.file.name.split('/').map(encodeURIComponent).join('/');
            try {
              playStream(stream, entry.title || title);
            } catch (e) {
              toast('Помилка плеєра: ' + e.message);
            }
          });
        });
    });
  }


  function playStream(url, title) {
    try {
      Lampa.Player.play({url: url, title: title});
      if (Lampa.Player.playlist) Lampa.Player.playlist([{url: url, title: title}]);
    } catch (e) { toast('Плеєр: ' + e.message); }
  }

  function searchCommons(card) {
    var title = nameOf(card);
    if (!title) return toast('Не вдалося визначити назву');
    toast('Шукаємо відео Wikimedia Commons...');
    var api = 'https://commons.wikimedia.org/w/api.php?origin=*&action=query&format=json' +
      '&generator=search&gsrnamespace=6&gsrlimit=30&gsrsearch=' +
      encodeURIComponent(title + ' filetype:video') +
      '&prop=imageinfo&iiprop=url%7Cmime%7Csize&iiurlwidth=720';
    json(api, function (err, data) {
      if (err) return toast('Wikimedia: ' + err.message);
      var pages = (data.query && data.query.pages) || {};
      var results = Object.keys(pages).map(function(k){return pages[k];})
        .filter(function(p) {
          var info = p.imageinfo && p.imageinfo[0];
          return info && info.url && /video\//i.test(info.mime || '') && similarity(p.title.replace(/^File:/, ''), title) >= 25;
        }).sort(function(a,b) {
          return similarity(b.title, title) - similarity(a.title, title);
        });
      if (!results.length) return toast('У Wikimedia Commons відео цього фільму не знайдено');
      pick(results.slice(0,20).map(function (p) {
        return {title: p.title.replace(/^File:/, ''), page: p,
          subtitle: 'Wikimedia Commons · відкрита ліцензія'};
      }), 'Wikimedia Commons', function(selected) {
        var info = selected.page.imageinfo[0];
        pick([{title:'Оригінальна доріжка', subtitle:'Мова залежить від відео'}],
          'Озвучка', function() {
            pick([{title:'Оригінальний файл · ' + ((info.mime || '').split('/')[1] || 'відео').toUpperCase(),
              url:info.url}], 'Якість', function(choice) {
                playStream(choice.url, selected.title);
              });
          });
      });
    });
  }


  var FILMIX_SCRIPT = 'https://lampaplugins.github.io/store/fx.js';
  function loadRemoteScript(url, success) {
    var script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = function(){ if (success) success(); };
    script.onerror = function(){ toast('Не вдалося завантажити розширення'); };
    document.head.appendChild(script);
  }
  function activateFilmix() {
    if (window.XOTT_FILMIX_LOADED) return toast('Filmix уже завантажено. Повторно відкрийте картку фільму.');
    pick([
      {title:'Підключити Filmix', action:'accept', subtitle:'Завантажити стороннє розширення fx.js'},
      {title:'Скасувати', action:'cancel'}
    ], 'Зовнішній плагін Filmix', function(choice) {
      if (choice.action !== 'accept') return;
      loadRemoteScript(FILMIX_SCRIPT, function(){
        window.XOTT_FILMIX_LOADED = true;
        toast('Filmix завантажено. Закрийте й відкрийте картку повторно.');
      });
    });
  }
  function configLampac() {
    if (!Lampa.Input || !Lampa.Input.edit) {
      return toast('Ця версія Lampa не підтримує налаштування адреси');
    }
    Lampa.Input.edit({
      title:'URL вашого сервера Lampac (http://IP:9118)',
      value:Lampa.Storage.get('xott_lampac_url',''), free:true, nosave:true
    },function(value){
      value=String(value||'').trim().replace(/\/+$/,'');
      if (!/^https?:\/\//i.test(value)) return toast('Введіть http:// або https:// адресу');
      Lampa.Storage.set('xott_lampac_url',value);
      toast('Адресу збережено. Виберіть HDRezka ще раз.');
    });
  }
  function useLampac() {
    var host = Lampa.Storage.get('xott_lampac_url','');
    if (!host) return configLampac();
    pick([
      {title:'Завантажити онлайн-модуль Lampac', action:'connect', subtitle:host+'/on.js'},
      {title:'Змінити адресу сервера', action:'edit'}
    ], 'HDRezka та інші провайдери · Lampac', function(choice){
      if (choice.action === 'edit') return configLampac();
      if (window.XOTT_LAMPAC_LOADED) return toast('Lampac підключено. Відкрийте картку ще раз.');
      loadRemoteScript(host+'/on.js',function(){
        window.XOTT_LAMPAC_LOADED=true;
        toast('Lampac підключено. Доступні джерела залежать від налаштувань сервера.');
      });
    });
  }

  function openSourceMenu(card) {
    lastCard = card || lastCard;
    if (!lastCard) return toast('Спочатку відкрийте картку фільму');
    pick([{title:'Internet Archive', subtitle:'Архів відкритих відеоматеріалів', id:'archive'},
      {title:'Wikimedia Commons', subtitle:'Відео з вільними ліцензіями', id:'commons'},
      {title:'Filmix · окреме розширення', subtitle:'Підключити сторонній Filmix-плагін', id:'filmix'},
      {title:'HDRezka та інші · Lampac', subtitle:'Потрібен власний запущений сервер Lampac', id:'lampac'}],
      'Вибрати джерело', function (item) {
        if (item.id === 'archive') searchArchive(lastCard);
        if (item.id === 'commons') searchCommons(lastCard);
        if (item.id === 'filmix') activateFilmix();
        if (item.id === 'lampac') useLampac();
      });
  }

  function inject(e) {
    if (!e || (e.type !== 'complite' && e.type !== 'complete')) return;
    var c = e.data || e.object || {};
    var card = c.movie || c.card || c;
    if (!card || !nameOf(card)) return;
    var root = (e.object && e.object.activity && e.object.activity.render && e.object.activity.render()) ||
      (e.data && e.data.activity && e.data.activity.render && e.data.activity.render()) ||
      (window.jQuery && window.jQuery(document));
    if (!root || !root.find) return;
    var buttons = root.find('.full-start-new__buttons').first();
    if (!buttons.length) buttons = root.find('.full-start__buttons').first();
    if (!buttons.length || buttons.find('.' + BUTTON_CLASS).length) return;
    var $ = window.jQuery || window.$;
    if (!$) return;
    var button = $('<div class="full-start__button selector view--online ' + BUTTON_CLASS + '" data-xott="online">' +
      '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' +
      '<span>Онлайн</span></div>');
    button.on('hover:enter click', function () { openSourceMenu(card); });
    buttons.prepend(button);
  }

  function init() {
    if (window.XOTT_ONLINE_INITIALIZED) return;
    window.XOTT_ONLINE_INITIALIZED = true;
    Lampa.Listener.follow('full', inject);
    console.log('[XOTT Online] v0.5.0 initialized');
  }

  if (typeof Lampa === 'undefined') return;
  if (window.appready) init();
  else Lampa.Listener.follow('app', function(e) { if (e.type === 'ready') init(); });
})();
