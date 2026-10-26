/* XOTT TV local extension. No online-source plugin is installed automatically. */
(function () {
    'use strict';
    if (window.XOTT_APP_EXTENSION) return;
    window.XOTT_APP_EXTENSION = true;
    function info() {
        var video = document.createElement('video');
        var lines = [
            'XOTT TV __VERSION__ / Lampa ' + Lampa.Manifest.app_version,
            'Режим: ' + (window.XOTT_SAFE_MODE ? 'безпечний' : 'звичайний'),
            'TV-профіль: ' + (window.XOTT_TV ? 'так' : 'ні'),
            'MP4 H.264: ' + (video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"') || 'не заявлено'),
            'HLS: ' + (video.canPlayType('application/vnd.apple.mpegurl') || 'не заявлено'),
            'Сховище: ' + (window.XOTT_STORAGE_ERROR ? 'недоступне' : 'доступне'),
            navigator.userAgent,
            'Підтримка формату браузером не гарантує відтворення конкретного потоку.'
        ];
        var content = $('<div></div>');
        lines.forEach(function (line) { content.append($('<p></p>').text(line)); });
        Lampa.Modal.open({title: 'XOTT TV · Діагностика', html: content, size: 'large', onBack: function () {
            Lampa.Modal.close(); Lampa.Controller.toggle('settings');
        }});
    }
    function action(title, description, handler) {
        Lampa.SettingsApi.addParam({component: 'xott_tv', param: {type: 'button'},
            field: {name: title, description: description},
            onRender: function (item) { item.on('hover:enter', handler); }
        });
    }
    function ready() {
        clearTimeout(window.XOTT_BOOT_TIMER);
        $('#xott-recovery').hide();
        $('.head__logo-icon').empty().append($('<span class="xott-brand"></span>').text('XOTT TV'));
        Lampa.SettingsApi.addComponent({component: 'xott_tv', name: 'XOTT TV', icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 4h18v13H3V4zm2 2v9h14V6H5zm3 13h8v2H8z"/></svg>'});
        action('Діагностика телевізора', 'Версія, браузер, HLS та MP4', info);
        action('Безпечний режим', 'Перезапуск без сторонніх плагінів. Налаштування зберігаються.', function () { location.href = '?safe=1'; });
        action('Звичайний режим', 'Перезапуск із вашими плагінами', function () { location.href = './'; });
        if (window.XOTT_SAFE_MODE) Lampa.Noty.show('Безпечний режим: сторонні плагіни вимкнені');
    }
    if (window.appready) ready();
    else Lampa.Listener.follow('app', function (event) { if (event.type === 'ready') ready(); });
})();
