/* XOTT TV bootstrap. ES5 for TV browsers. */
(function () {
    'use strict';
    window.youtube_lazy_load = true;
    window.XOTT_SAFE_MODE = /(?:\?|&)safe=1(?:&|$)/.test(location.search);
    window.XOTT_TV = /vidaa|hisense|smarttv|smart-tv|smart tv|hbbtv|nettv|tizen|webos|viera/i.test(navigator.userAgent);
    window.lampa_settings = {
        socket_use: false,
        account_use: false,
        account_sync: false,
        plugins_use: !window.XOTT_SAFE_MODE,
        plugins_store: true,
        lang_use: true,
        disable_features: {remote_configuration: true}
    };
    /* Defaults only: never overwrite preferences on the next launch. */
    var defaults = {language: 'uk', tmdb_lang: 'uk', player: 'inner', player_iptv: 'inner', player_torrent: 'inner'};
    if (window.XOTT_TV) {
        defaults.navigation_type = 'controll';
        defaults.animation = 'false';
        defaults.advanced_animation = 'false';
        defaults.background_type = 'simple';
        defaults.poster_size = 'w300';
        defaults.player_hls_method = 'application';
    }
    try {
        for (var key in defaults) {
            if (Object.prototype.hasOwnProperty.call(defaults, key) && localStorage.getItem(key) === null) {
                localStorage.setItem(key, defaults[key]);
            }
        }
    } catch (error) {
        window.XOTT_STORAGE_ERROR = true;
    }
    window.XOTT_BOOT_TIMER = setTimeout(function () {
        if (!window.appready) document.getElementById('xott-recovery').style.display = 'block';
    }, 45000);
    window.XOTT_BOOT_ERROR = function () {
        document.getElementById('xott-recovery').style.display = 'block';
    };
})();
