/* Telegram device-code account and versioned, per-account local snapshots. ES5. */
(function () {
    'use strict';
    var api = String(window.XOTT_CONFIG.api || '').replace(/\/$/, '');
    var token = '', user = null, timer, pollTimer, version = 0, syncing = false, dirty = false, suppress = false;
    var lastState = null, generation = 0;
    function request(path, method, data, callback) {
        if (!api) return callback(new Error('Сервер акаунтів ще не підключений'));
        var xhr = new XMLHttpRequest(), finished = false;
        function done(error, result) { if (!finished) { finished = true; callback(error, result); } }
        xhr.open(method || 'GET', api + path, true); xhr.timeout = 20000;
        xhr.setRequestHeader('Content-Type', 'application/json');
        if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        xhr.onload = function () {
            var result; try { result = JSON.parse(xhr.responseText); } catch (_) { return done(new Error('Некоректна відповідь сервера')); }
            if (xhr.status >= 200 && xhr.status < 300) return done(null, result);
            var error = new Error(result.error || 'Помилка сервера'); error.status = xhr.status; done(error);
        };
        xhr.onerror = function () { done(new Error('Сервер недоступний. Перевірте інтернет.')); };
        xhr.ontimeout = function () { done(new Error('Сервер не відповів вчасно')); };
        xhr.send(data ? JSON.stringify(data) : null);
    }
    function notice(text) { Lampa.Noty.show(text); }
    function localState() { return {favorite: Lampa.Storage.get('favorite', '{}'), file_view: Lampa.Storage.get('file_view', '{}')}; }
    function apply(data) {
        suppress = true;
        ['favorite', 'file_view'].forEach(function (key) { if (data[key]) Lampa.Storage.set(key, data[key]); });
        Lampa.Favorite.read(); Lampa.Timeline.read(); suppress = false;
    }
    /* Three-way merge: unchanged remote values may be replaced/deleted locally;
       changed remote values win ties, while progress uses its own timestamps. */
    function merge(base, local, remote) {
        var output = JSON.parse(JSON.stringify(remote || {}));
        var previous = base || {};
        var lf = local.favorite || {}, rf = output.favorite || {}, bf = previous.favorite || {};
        Object.keys(lf).forEach(function (key) {
            if (!Array.isArray(lf[key])) return;
            var current = rf[key] || [], before = bf[key] || [], own = lf[key];
            var identity = function (value) { return String(value && typeof value === 'object' ? (value.source || 'tmdb') + ':' + (value.id || value.original_title || value.title) : value); };
            var ids = own.map(identity), baseIds = before.map(identity);
            current = current.filter(function (value) { var id = identity(value); return baseIds.indexOf(id) < 0 || ids.indexOf(id) >= 0; });
            own.forEach(function (value) { if (baseIds.indexOf(identity(value)) < 0 && !current.some(function (other) { return identity(other) === identity(value); })) current.push(value); });
            rf[key] = current.slice(0, 1000);
        });
        output.favorite = rf;
        var progress = output.file_view || {};
        Object.keys(local.file_view || {}).forEach(function (key) {
            var own = local.file_view[key], other = progress[key];
            if (!other || (own.updated || 0) > (other.updated || 0)) progress[key] = own;
        });
        output.file_view = progress;
        return output;
    }
    function sync(show, callback) {
        callback = callback || function () {};
        if (!token || syncing) return callback();
        syncing = true;
        var runGeneration = generation;
        var snapshot = localState(); dirty = false;
        request('/api/state', 'GET', null, function (error, remote) {
            if (runGeneration !== generation) return;
            if (error) return end(error);
            version = remote.version;
            var merged = merge(lastState, snapshot, remote.data);
            request('/api/state', 'PUT', {version: version, data: merged}, function (writeError, saved) {
                if (runGeneration !== generation) return;
                if (writeError) { dirty = true; return end(writeError); }
                version = saved.version; lastState = JSON.parse(JSON.stringify(merged));
                if (user) Lampa.Storage.set('xott_last_state_' + user.id, lastState, true);
                if (!dirty) apply(merged);
                end();
            });
        });
        function end(error) {
            if (runGeneration !== generation) return;
            syncing = false;
            if (error && error.status === 401) { token = ''; Lampa.Storage.set('xott_session', ''); }
            if (show) notice(error ? error.message : 'Закладки й прогрес синхронізовано');
            if (dirty && token) { clearTimeout(timer); timer = setTimeout(function () { sync(false); }, 5000); }
            callback(error);
        }
    }
    function isolate(nextUser) {
        var old = Lampa.Storage.get('xott_account_id', '');
        if (old && old !== nextUser.id) {
            Lampa.Storage.set('xott_backup_' + old, localState(), true);
            var backup = Lampa.Storage.get('xott_backup_' + nextUser.id, '{}');
            Lampa.Storage.set('favorite', backup.favorite || {}, true); Lampa.Storage.set('file_view', backup.file_view || {}, true);
            Lampa.Favorite.read(); Lampa.Timeline.read();
        }
        Lampa.Storage.set('xott_account_id', nextUser.id, true);
        lastState = Lampa.Storage.get('xott_last_state_' + nextUser.id, '{}');
    }
    function login() {
        clearTimeout(pollTimer);
        request('/api/login/start', 'POST', {device: window.XOTT_TV ? 'Телевізор · ' + navigator.userAgent.slice(0, 55) : 'Браузер'}, function (error, pending) {
            if (error) return notice(error.message);
            var active = true, until = Date.now() + pending.expires_in * 1000;
            var panel = $('<div class="xott-login"></div>');
            panel.append($('<p></p>').text('Відкрийте Telegram-бота, надішліть код і підтвердьте вхід:'));
            panel.append($('<div class="xott-login__code"></div>').text(pending.code.slice(0, 4) + '-' + pending.code.slice(4)));
            panel.append($('<p></p>').text(pending.url));
            var qr = $('<div class="xott-login__qr"></div>'); panel.append(qr);
            if (window.QRCode) new QRCode(qr[0], {text: pending.url, width: 192, height: 192});
            panel.append($('<p></p>').text('Код діє 10 хвилин. Не передавайте його іншим.'));
            var status = $('<p></p>').text('Очікуємо підтвердження…'); panel.append(status);
            Lampa.Modal.open({title: 'Вхід через Telegram', html: panel, size: 'large', onBack: function () {
                active = false; clearTimeout(pollTimer); Lampa.Modal.close(); Lampa.Controller.toggle('settings');
            }});
            function poll() {
                if (!active) return;
                if (Date.now() >= until) { status.text('Код прострочено. Закрийте вікно та створіть новий.'); return; }
                request('/api/login/poll', 'POST', {id: pending.id, poll_token: pending.poll_token}, function (pollError, result) {
                    if (!active) return;
                    if (pollError) {
                        status.text(pollError.message);
                        if (pollError.status === 410 || pollError.status === 403) return;
                    } else if (result.status === 'approved') {
                        generation++; syncing = false; lastState = null; token = result.token; Lampa.Storage.set('xott_session', token, true);
                        request('/api/me', 'GET', null, function (meError, me) {
                            if (meError) return status.text(meError.message);
                            user = me; isolate(me); active = false; Lampa.Modal.close(); Lampa.Controller.toggle('settings');
                            sync(true); notice('Вітаємо, ' + me.name + '!');
                        });
                        return;
                    }
                    pollTimer = setTimeout(poll, pending.interval * 1000);
                });
            }
            pollTimer = setTimeout(poll, pending.interval * 1000);
        });
    }
    function logout() {
        if (!token) return notice('Ви ще не увійшли');
        request('/api/logout', 'POST', {}, function (error) {
            if (error) return notice(error.message);
            generation++; syncing = false; token = ''; user = null; lastState = null;
            Lampa.Storage.set('xott_session', '', true); clearTimeout(timer); notice('Ви вийшли з акаунта');
        });
    }
    window.XottAccount = {request: request, login: login, logout: logout, sync: sync, user: function () { return user; }, ready: function () {
        token = Lampa.Storage.get('xott_session', '');
        if (token) request('/api/me', 'GET', null, function (error, me) { if (!error) { user = me; isolate(me); sync(false); } else if (error.status === 401) { token = ''; Lampa.Storage.set('xott_session', '', true); } });
        Lampa.Storage.listener.follow('change', function (event) {
            if (suppress || !token || ['favorite', 'file_view'].indexOf(event.name) < 0) return;
            dirty = true; clearTimeout(timer); timer = setTimeout(function () { sync(false); }, 2000);
        });
        setInterval(function () { if (token) sync(false); }, 60000);
    }};
})();
