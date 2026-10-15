/* XOTT Online — Lampa MX plugin, v0.8.0
 * Direct source selection with HDRezka network modes and Filmix account-quality settings.
 * Audio, seasons, episodes, and quality are controlled by the selected provider UI.
 * Also includes Internet Archive and Wikimedia Commons search.
 */
(function () {
  'use strict';
  if (window.XOTT_ONLINE_V08) return;
  window.XOTT_ONLINE_V08 = true;

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


  // XOTT's single source selector opens the chosen balancer directly
  // inside Online MOD, which handles voice/season/episode/quality.
  // No local VPS or proxy is operated by XOTT.
  var MOD_SCRIPT = 'https://cdn.jsdelivr.net/gh/nb557/plugins@851bcc9bc064ac06dc2b0e7ff6631baba61be511/online_mod.js';
  var MOD_CONSENT_KEY = 'xott_online_mod_consent';
  var MOD_BALANSERS = [
    {id:'rezka2', title:'HDRezka · через проксі', description:'Спроба виправити мережеву помилку (через сторонній проксі)', balancer:'rezka2', mode:'proxy-mirror'},
    {id:'rezka-direct', title:'HDRezka · напряму', description:'Якщо проксі не відповідає', balancer:'rezka2', mode:'direct'},
    {id:'rezka-host-proxy', title:'HDRezka · альтернативний сервер', description:'Інший маршрут через проксі, якщо перші не працюють', balancer:'rezka2', mode:'proxy-origin'},
    {id:'filmix', title:'Filmix', description:'480p без підтвердженого доступу; вища якість залежить від акаунта'},
    {id:'cdnvideohub', title:'CDNVideoHub', description:'Ще одне онлайн-джерело'},
    {id:'kodik', title:'Kodik', description:'Серіали та аніме'},
    {id:'anilibria2', title:'AniLibria', description:'Аніме'}
  ];
  var QUALITY_HELP = {
    id:'filmix-settings', title:'Filmix · налаштувати якість (720p+)',
    description:'Авторизація Filmix, прив’язка пристрою та перевірка тарифу',
    settings:true
  };
  var modLoading = false;
  var pendingSelection = null;

  function stored(key, fallback) {
    try { return Lampa.Storage.get(key, fallback); }
    catch (e) { return fallback; }
  }

  function save(key, value) {
    try { Lampa.Storage.set(key, value); }
    catch (e) { console.warn('[XOTT Online] Cannot save setting', key, e); }
  }

  function modRegistered() {
    try {
      if (Lampa.SettingsApi && typeof Lampa.SettingsApi.getComponent === 'function') {
        if (Lampa.SettingsApi.getComponent('online_mod')) return true;
      }
    } catch (e) {}
    return window.XOTT_MOD_READY === true;
  }

  function saveBalancerForCard(card, balancer) {
    save('online_mod_balanser', balancer);

    // Online MOD also supports per-movie saved balancers. Override only
    // this selected movie so an older preference cannot win.
    try {
      if (card && card.id && Lampa.Storage.field &&
          Lampa.Storage.field('online_mod_save_last_balanser') === true &&
          Lampa.Storage.cache) {
        var perMovie = Lampa.Storage.cache('online_mod_last_balanser', 200, {});
        perMovie[card.id] = balancer;
        save('online_mod_last_balanser', perMovie);
      }
    } catch (e) {}
  }

  function launchSelectedBalancer(card, entry) {
    if (!card || !nameOf(card) || !entry) {
      return toast('Не вдалося визначити картку фільму');
    }
    if (!Lampa.Activity || typeof Lampa.Activity.push !== 'function') {
      return toast('Lampa MX не підтримує цей онлайн-модуль');
    }

    if (entry.settings) {
      var quality = window.mod_filmix && window.mod_filmix.max_qualitie;
      toast('Filmix: якість залежить від прав акаунта' + (quality ? ' (зараз до ' + quality + 'p)' : ''));
      if (Lampa.Settings && typeof Lampa.Settings.create === 'function') {
        try {
          Lampa.Settings.create('online_mod_filmix', {
            onBack:function () {
              if (Lampa.Settings && Lampa.Settings.create) Lampa.Settings.create('online_mod');
            }
          });
        } catch (e) {
          console.warn('[XOTT Online] Filmix settings unavailable', e);
          toast('Налаштування → Онлайн МОД → Filmix → додати пристрій / токен');
        }
      } else {
        toast('Відкрий Налаштування → Онлайн МОД → Filmix');
      }
      return;
    }

    if ((entry.balancer || entry.id) === 'rezka2') {
      // Online MOD defaults to direct requests, which are rejected by
      // some WebViews (cross-origin / network errors). Proxy use is
      // optional and visible in the source name, not a silent bypass.
      var mode = entry.mode || 'proxy-mirror';
      save('online_mod_proxy_rezka2', mode !== 'direct');
      save('online_mod_proxy_rezka2_mirror', mode === 'proxy-mirror');
    }

    saveBalancerForCard(card, entry.balancer || entry.id);
    try {
      Lampa.Activity.push({
        url: '',
        title: 'XOTT Online · ' + entry.title,
        component: 'online_mod',
        search: nameOf(card),
        search_one: card.title || card.name || nameOf(card),
        search_two: card.original_title || card.original_name || '',
        movie: card,
        page: 1
      });
    } catch (e) {
      console.error('[XOTT Online] Cannot open balancer', e);
      toast('Не вдалося відкрити ' + entry.title);
    }
  }

  function hideDuplicateModButton() {
    try {
      var id = 'xott-hide-mod-card-button';
      if (document.getElementById && document.getElementById(id)) return;
      var style = document.createElement('style');
      style.id = id;
      style.textContent = '.full-start__button.view--online_mod{display:none !important}';
      (document.head || document.documentElement).appendChild(style);
    } catch (e) {
      console.warn('[XOTT Online] Could not hide duplicate button', e);
    }
  }

  function openBalancer(card, entry) {
    if (!card || !entry) return;
    pendingSelection = {card:card, entry:entry};

    if (modRegistered()) {
      hideDuplicateModButton();
      launchSelectedBalancer(card, entry);
      return;
    }
    if (modLoading) return toast('Завантажуємо онлайн-джерела, зачекайте...');

    function load() {
      modLoading = true;
      toast('Підключаємо джерела для ' + entry.title + '...');
      // Do not treat an external script as trusted without user consent.
      var script = document.createElement('script');
      script.src = MOD_SCRIPT;
      script.async = true;
      script.onload = function () {
        modLoading = false;
        // Component init in Online MOD is synchronous in the checked revision.
        if (!modRegistered()) return toast('Онлайн-модуль завантажено, але він не запустився');
        window.XOTT_MOD_READY = true;
        hideDuplicateModButton();
        var selected = pendingSelection;
        pendingSelection = null;
        if (selected) launchSelectedBalancer(selected.card, selected.entry);
      };
      script.onerror = function () {
        modLoading = false;
        pendingSelection = null;
        toast('Не вдалося завантажити Онлайн МОД. Перевірте мережу.');
      };
      (document.head || document.documentElement).appendChild(script);
    }

    if (stored(MOD_CONSENT_KEY, false) === true) return load();

    pick([
      {
        title:'Підключити онлайн-джерела',
        subtitle:'Сторонній скрипт Онлайн МОД із GitHub',
        action:'allow'
      },
      {
        title:'Скасувати',
        action:'cancel'
      }
    ], 'Дозвіл на запуск зовнішнього розширення', function (choice) {
      if (!choice || choice.action !== 'allow') {
        pendingSelection = null;
        return;
      }
      save(MOD_CONSENT_KEY, true);
      load();
    });
  }

  function openSourceMenu(card) {
    lastCard = card || lastCard;
    if (!lastCard) return toast('Спочатку відкрийте картку фільму');
    var options = MOD_BALANSERS.map(function (entry) {
      return {
        id:entry.id,
        title:entry.title,
        subtitle:entry.description,
        balancer:entry
      };
    });
    options.push({
      id:QUALITY_HELP.id,
      title:QUALITY_HELP.title,
      subtitle:QUALITY_HELP.description,
      balancer:QUALITY_HELP
    });
    options.push({
      id:'archive', title:'Internet Archive',
      subtitle:'Відкриті відеоматеріали'
    });
    options.push({
      id:'commons', title:'Wikimedia Commons',
      subtitle:'Відео з вільними ліцензіями'
    });
    pick(options, 'XOTT Online · Обери джерело', function (option) {
      if (option.id === 'archive') return searchArchive(lastCard);
      if (option.id === 'commons') return searchCommons(lastCard);
      if (option.balancer) openBalancer(lastCard, option.balancer);
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
    console.log('[XOTT Online] v0.8.0 initialized');
  }

  if (typeof Lampa === 'undefined') return;
  if (window.appready) init();
  else Lampa.Listener.follow('app', function(e) { if (e.type === 'ready') init(); });
})();
