/* XOTT Online v0.10.0 · generated from src/ · no Lumio code copied */
/* KADR UA source client. Original implementation of the Lampac HTTP data protocol.
 * No Lumio code, assets, telemetry, remote scripts or account credentials are included.
 * MIT, 2026 KADR UA / XOTT.
 */
(function (root) {
  'use strict';
  var MAX_BODY = 2 * 1024 * 1024;
  function failure(code, message) { var e = new Error(message); e.code = code; return e; }
  function plain(value, limit) {
    return String(value == null ? '' : value).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, limit || 240);
  }
  function apiBase(value) {
    var url;
    try { url = new URL(value); } catch (e) { throw failure('CONFIG', 'Вкажіть HTTPS-адресу API сервера джерел.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw failure('CONFIG', 'Адреса API має бути HTTPS, без паролів, параметрів і фрагмента.');
    return url.href.replace(/\/+$/, '');
  }
  function absolute(value, base) {
    if (typeof value !== 'string' || !value.trim() || value.length > 8192) return '';
    value = value.trim();
    if (/^https?:\/\/(?:127\.0\.0\.1|localhost):9118(?:\/|$)/i.test(value)) value = base + value.replace(/^https?:\/\/(?:127\.0\.0\.1|localhost):9118/i, '');
    else if (value.indexOf('/lite/') === 0 || value.indexOf('/proxy/') === 0) value = base + value;
    try { var u = new URL(value, base + '/'); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch (e) { return ''; }
  }
  function owned(value, base) {
    var url = absolute(value, base), origin = new URL(base);
    if (!url) return '';
    var target = new URL(url);
    return target.origin === origin.origin && (target.pathname === origin.pathname || target.pathname.indexOf(origin.pathname.replace(/\/$/, '') + '/') === 0) ? url : '';
  }
  function format(url, hint) { return hint === 'hls' || /\.m3u8(?:[?#]|$)/i.test(url) ? 'hls' : 'mp4'; }
  function mediaUrl(value, base) {
    if (value && typeof value === 'object') value = value.url || value.file || value.link || value.src;
    // The protocol can return a reserve URL after " or ". Do not make it part of a URL.
    return absolute(typeof value === 'string' ? value.split(' or ')[0] : '', base);
  }
  function subtitles(value, base) {
    var rows = Array.isArray(value) ? value : typeof value === 'string' ? [{url:value}] : [];
    return rows.slice(0, 20).map(function (t) {
      return {url:mediaUrl(t.url || t.src,base),language:plain(t.language || t.lang || 'uk',10),label:plain(t.label || t.name || 'Субтитри',60)};
    }).filter(function(t){return t.url && /\.vtt(?:[?#]|$)/i.test(t.url);});
  }
  function streams(data, base, context) {
    context = context || {};
    var entries = [], seen = {}, quality = data.quality;
    var audio = plain(data.translate || data.voice_name || data.audio || context.audio || 'Оригінал', 120);
    var season = Number(data.season != null ? data.season : context.season), episode = Number(data.episode != null ? data.episode : context.episode);
    function add(value, label) {
      var url = mediaUrl(value,base);
      if (!url || seen[url]) return;
      seen[url] = true;
      var row = {url:url,format:format(url,data.format),label:plain(label || 'Авто',100),audio:audio,subtitles:subtitles(data.subtitles || data.subtitle,base)};
      if (isFinite(season) && season >= 0 && Math.floor(season)===season) row.season=season;
      if (isFinite(episode) && episode >= 1 && Math.floor(episode)===episode) row.episode=episode;
      entries.push(row);
    }
    if (quality && typeof quality === 'object' && !Array.isArray(quality)) {
      Object.keys(quality).sort(function(a,b){return (parseInt(b,10)||0)-(parseInt(a,10)||0);}).forEach(function(q){add(quality[q],q);});
    }
    if (!entries.length) add(data.stream || data.url, data.maxquality || data.label || 'Авто');
    // Repeated labels for one adaptive URL are not independently selectable resolutions.
    if (quality && Object.keys(quality).length > entries.length && entries.length === 1) entries[0].label = 'Авто · ' + entries[0].format.toUpperCase();
    return entries;
  }
  function parseResponse(raw, base, context) {
    var data = raw, rows = [], direct = false;
    if (typeof raw === 'string') {
      if (raw.length > MAX_BODY) throw failure('LIMIT','Відповідь сервера перевищує 2 МБ.');
      try { data = JSON.parse(raw); } catch (e) {
        if (!root.DOMParser) throw failure('FORMAT','Потрібен HTML-парсер браузера.');
        var doc = new root.DOMParser().parseFromString(raw,'text/html');
        var nodes = doc.querySelectorAll('[data-json]');
        for (var n=0;n<nodes.length && n<600;n++) {
          try {
            var row = JSON.parse(nodes[n].getAttribute('data-json'));
            row = Object.assign({},row);
            if (nodes[n].hasAttribute('s')) row.season = Number(nodes[n].getAttribute('s'));
            if (nodes[n].hasAttribute('e')) row.episode = Number(nodes[n].getAttribute('e'));
            var title = nodes[n].querySelector('.videos__item-title');
            row.text = title ? title.textContent : row.text || nodes[n].textContent;
            rows.push(row);
          } catch (ignored) {}
        }
        data = rows;
      }
    }
    if (data && !Array.isArray(data) && data.rch) throw failure('RCH','Це джерело потребує клієнта RCH. Оберіть інше джерело або сумісний сервер із серверним доступом.');
    if (data && !Array.isArray(data) && (data.error || data.msg) && !data.url && !data.stream) throw failure('UPSTREAM',plain(data.error || data.msg,300));
    if (data && !Array.isArray(data) && (data.url || data.stream || data.quality)) { rows=[data]; direct=true; }
    else rows=Array.isArray(data)?data:[];
    return rows.slice(0,600).map(function(d,index){
      if(!d || typeof d!=='object')return null;
      var title=plain(d.text || d.title || d.name || d.translate || 'Відео');
      var node={id:index,title:title,audio:plain(d.translate || d.voice_name || d.audio || (context||{}).audio || title,120),season:d.season != null?Number(d.season):(context||{}).season,episode:d.episode != null?Number(d.episode):(context||{}).episode,raw:d};
      if(d.folder || d.method==='link' || d.method==='folder') {node.kind='folder';node.url=owned(d.url,base);}
      else if(direct || d.method==='play' || d.stream || (d.url && /\.(?:mp4|m3u8|webm)(?:[?#]|$)/i.test(d.url))) {node.kind='stream';node.streams=streams(d,base,node);}
      else {node.kind='resolve';node.url=owned(d.url,base);}
      return (node.kind==='stream'?node.streams.length:node.url)?node:null;
    }).filter(Boolean);
  }
  function requestParams(url, item, uid) {
    var u=new URL(url);
    var values={id:item.tmdb_id || (item.source==='tmdb'?item.id:0),title:item.title||'',original_title:item.originalTitle||item.original_title||'',year:item.year||'',serial:item.type==='tv'?'1':'0',source:'tmdb',uid:uid};
    if(item.tmdb_id || item.source==='tmdb')values.tmdb_id=item.tmdb_id || item.id;
    if(item.imdb_id)values.imdb_id=item.imdb_id;
    if(item.kinopoisk_id)values.kinopoisk_id=item.kinopoisk_id;
    Object.keys(values).forEach(function(k){if(values[k]!=='' && values[k]!=null && !u.searchParams.has(k))u.searchParams.set(k,String(values[k]));});
    // Request the backend's real quality map instead of fabricating labels client-side.
    if(/\/lite\/(?:cdnvideohub|veoveo)(?:\/|$)/i.test(u.pathname))u.searchParams.set('quality','true');
    return u.href;
  }
  function hlsVariants(manifest, manifestUrl, stream) {
    if(typeof manifest!=='string'||manifest.indexOf('#EXTM3U')===-1)return [];
    var lines=manifest.split(/\r?\n/),variants=[],seen={};
    for(var i=0;i<lines.length;i++){
      if(lines[i].indexOf('#EXT-X-STREAM-INF:')!==0)continue;
      var resolution=lines[i].match(/RESOLUTION=\d+x(\d+)/i);
      if(!resolution)continue;
      var next=i+1;while(next<lines.length&&(!lines[next].trim()||lines[next].charAt(0)==='#'))next++;
      var url='';try{var target=new URL(lines[next],manifestUrl);if(target.protocol==='https:'&&!target.username&&!target.password)url=target.href;}catch(ignored){}var height=Number(resolution[1]);
      if(!url||!height||seen[url])continue;seen[url]=true;
      var copy=Object.assign({},stream,{url:url,label:height+'p',format:'hls'});variants.push(copy);
    }
    return variants.sort(function(a,b){return parseInt(b.label,10)-parseInt(a.label,10);});
  }
  function xhrRequest(url, options) {
    return new Promise(function(resolve,reject){
      var xhr=new root.XMLHttpRequest(),done=false;
      function finish(err,result){if(done)return;done=true;if(options.signal)options.signal.removeEventListener('abort',abort);if(err)reject(err);else resolve(result);}
      function abort(){xhr.abort();finish(failure('CANCELLED','Запит скасовано.'));}
      if(options.signal && options.signal.aborted)return abort();
      xhr.open('GET',url,true);xhr.timeout=options.timeout || 16000;
      xhr.onload=function(){if(xhr.status<200||xhr.status>=300)return finish(failure('HTTP','Сервер відповів HTTP '+xhr.status+'.'));if(xhr.responseText.length>MAX_BODY)return finish(failure('LIMIT','Відповідь сервера перевищує 2 МБ.'));finish(null,xhr.responseText);};
      xhr.onerror=function(){finish(failure('NETWORK','Джерело недоступне: мережа або CORS.'));};
      xhr.ontimeout=function(){finish(failure('TIMEOUT','Джерело не відповіло вчасно.'));};
      if(options.signal)options.signal.addEventListener('abort',abort,{once:true});
      xhr.send();
    });
  }
  function SourceClient(base, options) {
    options=options||{};this.base=apiBase(base);this.uid=options.uid || '';this.transport=options.transport || xhrRequest;this.timeout=options.timeout || 16000;
  }
  SourceClient.prototype.request=function(url,signal){
    var allowed=owned(url,this.base);if(!allowed)return Promise.reject(failure('ORIGIN','Сервер повернув посилання поза налаштованим API.'));
    return this.transport(allowed,{timeout:this.timeout,signal:signal});
  };
  SourceClient.prototype.prepare=function(item,signal){
    var self=this,id=item.tmdb_id || (item.source==='tmdb'?item.id:0);
    if(item.imdb_id || !id)return Promise.resolve(item);
    var url=new URL(this.base+'/externalids');url.searchParams.set('id',id);url.searchParams.set('serial',item.type==='tv'?'1':'0');if(this.uid)url.searchParams.set('uid',this.uid);
    return this.request(url.href,signal).then(function(raw){var data;try{data=typeof raw==='string'?JSON.parse(raw):raw;}catch(ignored){return item;}var imdb=data.imdb_id || data.imdbid,kp=data.kinopoisk_id || data.kinopoiskid || data.kp_id;if(/^tt\d+$/.test(String(imdb||'')))item.imdb_id=imdb;if(/^\d+$/.test(String(kp||'')))item.kinopoisk_id=kp;return item;},function(){return item;});
  };
  SourceClient.prototype.sources=function(item,signal){
    var self=this;
    return this.prepare(item,signal).then(function(){return self.request(requestParams(self.base+'/lite/events?life=false',item,self.uid),signal);}).then(function(raw){var rows;try{rows=typeof raw==='string'?JSON.parse(raw):raw;}catch(e){throw failure('FORMAT','Сервер повернув не список джерел.');}if(!Array.isArray(rows))throw failure('FORMAT','Сервер не повернув список джерел.');var seen={};return rows.slice(0,100).map(function(s){var id=plain(s.balanser || s.name,80).toLowerCase(),url=owned(s.url,self.base);if(!id||!url||seen[id])return null;seen[id]=true;return{id:id,name:plain(s.name||id),url:url,rch:!!s.rch};}).filter(Boolean).sort(function(a,b){function rank(s){return /^(uafilm|uakino|kinoukr|eneyida)$/.test(s.id)?0:/^(veoveo|cdnvideohub)$/.test(s.id)?1:2;}return rank(a)-rank(b);});});
  };
  SourceClient.prototype.browse=function(provider,item,signal){
    var self=this;if(provider.rch)return Promise.reject(failure('RCH','Джерело потребує клієнта RCH. У браузері оберіть інше джерело.'));
    return this.request(requestParams(provider.url,item,this.uid),signal).then(function(raw){return parseResponse(raw,self.base,provider);});
  };
  SourceClient.prototype.open=function(node,item,signal){
    if(node.kind==='stream')return Promise.resolve([node]);var self=this;
    return this.request(requestParams(node.url,item,this.uid),signal).then(function(raw){return parseResponse(raw,self.base,node);});
  };
  // Keep the master URL: redirects, signatures and separate audio groups must stay intact.
  SourceClient.prototype.enrich=function(list){
    var self=this;
    if(!list || list.length!==1 || list[0].format!=='hls')return Promise.resolve(list||[]);
    var stream=list[0];
    return this.transport(stream.url,{timeout:10000}).then(function(raw){var variants=hlsVariants(raw,stream.url,stream);return variants.length?[Object.assign({},stream,{label:'Авто · HLS (до '+variants[0].label+')',levels:variants.map(function(v){return parseInt(v.label,10);})})]:list;},function(){return list;});
  };
  root.KadrSources={SourceClient:SourceClient,apiBase:apiBase,absolute:absolute,owned:owned,parseResponse:parseResponse,streams:streams,requestParams:requestParams,plain:plain,hlsVariants:hlsVariants};
})(typeof window!=='undefined'?window:globalThis);


/* XOTT Online — Lampa MX plugin, v0.9.0
 * Automatic HDRezka route checks and Filmix account-based quality settings.
 * Audio, seasons, episodes, and quality are controlled by the selected provider UI.
 * Also includes Internet Archive and Wikimedia Commons search.
 */
(function () {
  'use strict';
  if (window.XOTT_ONLINE_V09) return;
  window.XOTT_ONLINE_V09 = true;

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
    {id:'rezka2', title:'HDRezka', description:'Автоматично обираємо доступне з’єднання'},
    {id:'filmix', title:'Filmix', description:'Якість та озвучки за доступом Filmix'},
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

  var rezkaCheckId = 0;
  var rezkaLastChoice = null;
  var rezkaProbeTimeout = 5500;
  var rezkaProxyServers = [
    'https://cors.nb557.workers.dev/',
    'https://cors.fx666.workers.dev/'
  ];

  function allowedMirror(value) {
    var candidate = String(value || 'https://kvk.zone').trim();
    if (!/^https:\/\/[a-z0-9.-]+(?::443)?\/?$/i.test(candidate)) return 'https://kvk.zone';
    return candidate.replace(/\/$/, '');
  }

  function rezkaRouteCandidates() {
    var mirror = allowedMirror(stored('online_mod_rezka2_mirror',''));
    var custom = stored('online_mod_proxy_other_url','');
    var customs = [];
    if (stored('online_mod_proxy_other',false) === true && /^https:\/\/[a-z0-9.-]+\/$/i.test(String(custom || ''))) {
      customs.push(String(custom));
    }
    var proxies = customs.concat(rezkaProxyServers);
    var unique = {};
    var routes = [];
    function add(mode, host, proxy) {
      var id = mode + host + proxy;
      if (!unique[id]) {
        unique[id] = true;
        routes.push({mode:mode,host:host,proxy:proxy});
      }
    }
    var preferNative = false;
    try { preferNative = !!(Lampa.Platform && Lampa.Platform.is('android')); } catch (e) {}
    if (preferNative) add('direct',mirror,'');
    proxies.forEach(function(proxy) { add('proxy-mirror',mirror,proxy); });
    proxies.forEach(function(proxy) { add('proxy-origin','https://rezka.ag',proxy); });
    if (!preferNative) add('direct',mirror,'');
    return routes;
  }

  function rezkaProbeURL(route) {
    var url = route.host + '/engine/ajax/search.php';
    if (!route.proxy) return url;
    var ua = 'Mozilla/5.0 (compatible; XOTTOnline/0.9)';
    var params = 'param/Origin=' + encodeURIComponent(route.host) + '/'
      + 'param/Referer=' + encodeURIComponent(route.host + '/') + '/'
      + 'param/User-Agent=' + encodeURIComponent(ua) + '/';
    return route.proxy + 'enc2/' + encodeURIComponent(btoa(params + url)) + '/search.txt?jacred.test';
  }

  function looksLikeRezkaSearch(body) {
    if (typeof body !== 'string' || !body) return false;
    if (/anubis_challenge|cf-chl|cloudflare.*challenge|error-code|access denied|just a moment/i.test(body)) return false;
    // Empty valid search responses are possible; the upstream search page
    // returns list markup when results exist, but sometimes only a short HTML fragment.
    return /<li[^>]*>\s*<a\s|b-search__live_all|b-search__live|<div\s+class="b-search__live/i.test(body);
  }

  function findRezkaRoute(card, callback) {
    var request;
    try { request = new Lampa.Reguest(); } catch (e) { return callback(null); }
    if (!request || typeof request.native !== 'function') return callback(null);
    var routes = rezkaRouteCandidates();
    var n = 0;
    var op = ++rezkaCheckId;
    toast('HDRezka: перевіряємо доступне з’єднання...');
    function next() {
      if (op !== rezkaCheckId) return;
      if (n >= routes.length) {
        rezkaLastChoice = null;
        return callback(null);
      }
      var route = routes[n++];
      var responded = false;
      try {
        request.clear();
        request.timeout(rezkaProbeTimeout);
        request.native(rezkaProbeURL(route), function(data) {
          if (responded || op !== rezkaCheckId) return;
          responded = true;
          if (looksLikeRezkaSearch(data)) {
            rezkaLastChoice = {route:route,until:Date.now() + 120000};
            callback(route);
          } else next();
        }, function() {
          if (responded || op !== rezkaCheckId) return;
          responded = true;
          next();
        }, 'q=' + encodeURIComponent(nameOf(card)), {
          dataType:'text',
          withCredentials:false
        });
      } catch (e) { if (!responded) {responded=true;next();} }
    }
    if (rezkaLastChoice && Date.now() < rezkaLastChoice.until) {
      return callback(rezkaLastChoice.route);
    }
    next();
  }

  function saveRezkaRoute(route) {
    if (!stored('xott_rezka_restore', null)) {
      save('xott_rezka_restore', {
        enabled:stored('online_mod_proxy_other', false),
        url:stored('online_mod_proxy_other_url', '')
      });
    }
    save('online_mod_proxy_rezka2', !!route.proxy);
    save('online_mod_proxy_rezka2_mirror', route.host !== 'https://rezka.ag');
    if (route.proxy) {
      save('online_mod_proxy_other', true);
      save('online_mod_proxy_other_url', route.proxy);
    } else {
      save('online_mod_proxy_other', false);
    }
    // The upstream component reads its mirror from this key.
    if (route.host !== 'https://rezka.ag') save('online_mod_rezka2_mirror', route.host);
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
      return findRezkaRoute(card, function(route) {
        if (!route) {
          return toast('HDRezka зараз недоступна з цієї мережі: перевірені маршрути не відповіли. Спробуйте Filmix або інше джерело.');
        }
        saveRezkaRoute(route);
        openOnlineActivity(card, entry);
      });
    }

    openOnlineActivity(card, entry);
  }

  function openOnlineActivity(card, entry) {
    if ((entry.balancer || entry.id) !== 'rezka2') {
      var originalProxy = stored('xott_rezka_restore', null);
      if (originalProxy) {
        save('online_mod_proxy_other', originalProxy.enabled);
        save('online_mod_proxy_other_url', originalProxy.url);
        save('xott_rezka_restore', null);
      }
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
        subtitle:'Сторонній скрипт і проксі, яким можуть бути видимі адреси запитів',
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
    window.XOTTLegacyOpen = openSourceMenu;
    console.log('[XOTT Online] v0.9.0 initialized');
  }

  if (typeof Lampa === 'undefined') return;
  if (window.appready) init();
  else Lampa.Listener.follow('app', function(e) { if (e.type === 'ready') init(); });
})();


/* XOTT Online 0.10.0 — Lampac sources with the existing Online MOD as an optional fallback.
 * Backend streams are used as returned; no quality ceiling or account status is forged.
 */
(function () {
  'use strict';
  if (window.XOTT_ONLINE_V010 || typeof Lampa === 'undefined') return;
  window.XOTT_ONLINE_V010 = true;
  var DEFAULT_API = 'https://beta.mitsu.tv/api';
  var active = null, lastCard = null;
  function stored(key,fallback){try{return Lampa.Storage.get(key,fallback);}catch(e){return fallback;}}
  function save(key,value){try{Lampa.Storage.set(key,value);}catch(e){}}
  function notify(message){if(Lampa.Noty&&Lampa.Noty.show)Lampa.Noty.show(message);else console.log('[XOTT Online]',message);}
  function titleOf(card){return card&&(card.title||card.name||card.original_title||card.original_name)||'';}
  function movieOf(card){return{source:card.source||'tmdb',id:card.id||card.tmdb_id||0,tmdb_id:card.tmdb_id||card.id,title:titleOf(card),originalTitle:card.original_title||card.original_name||'',type:card.name||card.media_type==='tv'?'tv':'movie',year:String(card.release_date||card.first_air_date||'').slice(0,4),imdb_id:card.imdb_id||'',kinopoisk_id:card.kinopoisk_id||''};}
  function nativeTransport(url,options){return new Promise(function(resolve,reject){var done=false,net;function end(error,value){if(done)return;done=true;clearTimeout(timer);if(error)reject(error);else resolve(value);}var timer=setTimeout(function(){if(net)net.clear();end(new Error('Джерело не відповіло вчасно.'));},options.timeout+1000);try{net=new Lampa.Reguest();net.timeout(options.timeout);net.native(url,function(body){end(null,body);},function(error){var status=error&&error.status;end(new Error(status?'Сервер відповів HTTP '+status+'.':'Мережева помилка або CORS.'));},false,{dataType:'text',withCredentials:false});}catch(e){end(e);}});}
  function menu(title,items,onSelect,onBack){Lampa.Select.show({title:title,items:items,onSelect:function(item){Lampa.Controller.toggle('content');onSelect(item);},onBack:function(){Lampa.Controller.toggle('content');if(onBack)onBack();}});}
  function loading(on){try{if(on)Lampa.Loading.start();else Lampa.Loading.stop();}catch(e){}}
  function errorMenu(error,retry,back){var message=KadrSources.plain(error&&error.message||'Джерело недоступне.',300);notify(message);menu('XOTT · '+message,[{title:'Повторити',action:'retry'},{title:'Інше джерело',action:'back'}],function(item){if(item.action==='retry')retry();else back();},back);}
  function run(session,job,success,retry,back){var op=++session.sequence;loading(true);job().then(function(value){if(active!==session||op!==session.sequence)return;loading(false);success(value);},function(error){if(active!==session||op!==session.sequence)return;loading(false);errorMenu(error,retry,back);});}
  function play(session,stream,all){var quality={};all.forEach(function(s){quality[s.label]=s.url;});var entry={url:stream.url,title:titleOf(session.card)+(stream.episode?' · S'+stream.season+'E'+stream.episode:''),quality:quality};if(stream.subtitles&&stream.subtitles.length)entry.subtitles=stream.subtitles.map(function(s){return{url:s.url,label:s.label||s.language};});try{Lampa.Player.play(entry);if(Lampa.Player.playlist)Lampa.Player.playlist([entry]);}catch(e){notify('Плеєр: '+e.message);}}
  function qualities(session,node){var streams=node.streams||[];if(!streams.length)return notify('Сервер не повернув відеопосилання.');if(streams.length===1)return play(session,streams[0],streams);menu('XOTT · Якість',streams.map(function(s,i){return{title:s.label,subtitle:s.audio,index:i};}),function(choice){play(session,streams[choice.index],streams);},function(){drawFrame(session);});}
  function drawFrame(session){if(active!==session)return;var frame=session.frames[session.frames.length-1];if(!frame)return sourceMenu(session);if(!frame.rows.length)return errorMenu(new Error('Джерело відповіло, але відео за цією назвою не знайдено.'),function(){openNode(session,frame.from,true);},function(){session.frames.pop();drawFrame(session);});menu('XOTT · '+frame.title,frame.rows.map(function(node,i){return{title:node.title,subtitle:node.kind==='folder'?'Озвучки / сезони / серії':node.streams?node.streams.map(function(s){return s.label;}).join(' · '):'Отримати відео',index:i};}),function(choice){openNode(session,frame.rows[choice.index]);},function(){session.frames.pop();if(session.frames.length)drawFrame(session);else sourceMenu(session);});}
  function openNode(session,node,replace){if(node.kind==='stream')return run(session,function(){return session.client.enrich(node.streams);},function(streams){qualities(session,{streams:streams});},function(){openNode(session,node);},function(){drawFrame(session);});if(session.frames.length>=16)return notify('Надто багато переходів. Оберіть інше джерело.');run(session,function(){return session.client.open(node,session.movie);},function(rows){if(replace)session.frames.pop();session.frames.push({title:node.title,rows:rows,from:node});drawFrame(session);},function(){openNode(session,node,replace);},function(){drawFrame(session);});}
  function openProvider(session,provider){session.frames=[];if(provider.rch)return errorMenu(new Error('Провайдер потребує RCH. Оберіть інше джерело або відкрийте резервний Online MOD.'),function(){openProvider(session,provider);},function(){sourceMenu(session);});run(session,function(){return session.client.browse(provider,session.movie);},function(rows){session.frames=[{title:provider.name,rows:rows,from:{kind:'folder',url:provider.url,title:provider.name}}];drawFrame(session);},function(){openProvider(session,provider);},function(){sourceMenu(session);});}
  function sourceMenu(session){var choices=session.providers.map(function(p,i){return{title:p.name,subtitle:p.rch?'Потрібен RCH':/^(uafilm|uakino|kinoukr|eneyida)$/.test(p.id)?'Українське джерело · перевірити':'Озвучки та якість від сервера',provider:i};});choices.push({title:'Старі джерела / Filmix · мій акаунт',subtitle:'Резервний Online MOD із попередньої версії',action:'legacy'});choices.push({title:'Налаштувати сервер джерел',subtitle:session.client.base,action:'server'});menu('XOTT Online · Джерела',choices,function(choice){if(choice.action==='legacy'){session.sequence++;loading(false);if(window.XOTTLegacyOpen)window.XOTTLegacyOpen(session.card);else notify('Для резервного модуля видаліть старий XOTT Online та перезапустіть Lampa.');return;}if(choice.action==='server')return configure(session.card);openProvider(session,session.providers[choice.provider]);},function(){session.sequence++;});}
  function configure(card){var current=stored('xott_sources_api',DEFAULT_API);if(!Lampa.Input||!Lampa.Input.edit)return notify('Вкажіть xott_sources_api у сховищі Lampa або встановіть актуальну Lampa.');Lampa.Input.edit({title:'HTTPS-адреса Lampac API',value:current,free:true},function(value){try{var url=KadrSources.apiBase(value);save('xott_sources_api',url);open(card);}catch(e){notify(e.message);}});}
  function open(card){lastCard=card||lastCard;if(!lastCard||!titleOf(lastCard))return notify('Спочатку відкрийте картку фільму.');if(active)active.sequence++;var uid=stored('lampac_unic_id','')||stored('xott_sources_uid','');if(!uid){uid=Math.random().toString(36).slice(2,10);save('lampac_unic_id',uid);}save('xott_sources_uid',uid);var client;try{client=new KadrSources.SourceClient(stored('xott_sources_api',DEFAULT_API),{uid:uid,transport:nativeTransport});}catch(e){notify(e.message);return configure(lastCard);}var session={client:client,card:lastCard,movie:movieOf(lastCard),frames:[],providers:[],sequence:0};active=session;run(session,function(){return client.sources(session.movie);},function(rows){session.providers=rows;sourceMenu(session);},function(){open(session.card);},function(){menu('XOTT · Сервер недоступний',[{title:'Налаштувати сервер',action:'settings'},{title:'Резервний Online MOD',action:'legacy'}],function(item){if(item.action==='settings')configure(session.card);else if(window.XOTTLegacyOpen)window.XOTTLegacyOpen(session.card);});});}
  function inject(event){if(!event||(event.type!=='complite'&&event.type!=='complete'))return;var data=event.data||event.object||{},card=data.movie||data.card||data;if(!titleOf(card))return;var $=window.jQuery||window.$;if(!$)return;var view=(event.object&&event.object.activity&&event.object.activity.render&&event.object.activity.render())||(event.data&&event.data.activity&&event.data.activity.render&&event.data.activity.render())||$(document);var buttons=view.find('.full-start-new__buttons').first();if(!buttons.length)buttons=view.find('.full-start__buttons').first();if(!buttons.length)return;buttons.find('.xott-online-button').remove();var button=$('<div class="full-start__button selector view--online xott-online-button"><svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span>Онлайн</span></div>');button.on('hover:enter click',function(){open(card);});buttons.prepend(button);}
  function init(){Lampa.Listener.follow('full',inject);window.XOTTOnline={version:'0.10.0',open:open,configure:configure};console.log('[XOTT Online] v0.10.0 · Lampac sources');}
  if(window.appready)init();else Lampa.Listener.follow('app',function(e){if(e.type==='ready'&&!window.XOTTOnline)init();});
})();
