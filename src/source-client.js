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
