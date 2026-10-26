const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
function boot({ua = 'Hisense VIDAA SmartTV', search = '', saved = {}, blocked = false} = {}) {
    const values = {...saved};
    const context = {navigator: {userAgent: ua}, location: {search}, document: {getElementById: () => ({style: {}})}, setTimeout: () => 1,
        localStorage: {getItem: key => {if (blocked) throw Error('blocked'); return values[key] ?? null;}, setItem: (key, value) => {values[key] = value;}}};
    context.window = context;
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'app/bootstrap.js'), 'utf8'), context);
    return {context, values};
}
test('TV defaults preserve user preferences on relaunch', () => {
    const {values, context} = boot({saved: {language: 'en', player_hls_method: 'hlsjs', plugins: '[{"url":"https://example.com/plugin.js","status":1}]'}});
    assert.equal(values.language, 'en'); assert.equal(values.player_hls_method, 'hlsjs');
    assert.equal(values.navigation_type, 'controll'); assert.equal(values.animation, 'false');
    assert.equal(context.XOTT_TV, true); assert.match(values.plugins, /example.com/);
});
test('safe mode disables third-party loading without deleting the plugin list', () => {
    const plugins = '[{"url":"https://example.com/test.js","status":1}]';
    const {values, context} = boot({search: '?safe=1', saved: {plugins}});
    assert.equal(context.lampa_settings.plugins_use, false); assert.equal(values.plugins, plugins);
    assert.equal(boot({search: '?safe=10'}).context.XOTT_SAFE_MODE, false);
});
test('storage denial does not prevent boot', () => { assert.equal(boot({blocked: true}).context.XOTT_STORAGE_ERROR, true); });
test('desktop does not receive TV performance overrides', () => {
    const {values} = boot({ua: 'Mozilla/5.0 Windows NT Chrome'}); assert.equal(values.animation, undefined);
});
test('packaged MSX entry opens own application at project path', () => {
    const start = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/msx/start.json')));
    assert.equal(start.action, 'link:https://xott69.github.io/lampa69/app/');
    assert.equal(start.parameter, 'content:https://xott69.github.io/lampa69/msx/start.json');
});
test('all local script and stylesheet dependencies are packaged', () => {
    const app = path.join(ROOT, 'dist/app');
    const html = fs.readFileSync(path.join(app, 'index.html'), 'utf8');
    for (const match of html.matchAll(/(?:src|href)="([^"?]+)(?:\?[^" ]*)?"/g)) {
        if (match[1].startsWith('http') || match[1] === './') continue;
        assert.ok(fs.existsSync(path.join(app, match[1])), match[1]);
    }
    const plugin = fs.readFileSync(path.join(app, 'plugins/modification.js'), 'utf8');
    assert.doesNotMatch(plugin, /XOTT_ONLINE|online_mod|plugin\.js/);
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/build.json')));
    assert.equal(manifest.upstream, '616c80224518a7c7e04e2789d5811881b93bf611');
    assert.ok(fs.statSync(path.join(ROOT, 'dist/source/lampa-source.tar.gz')).size > 1000);
});
