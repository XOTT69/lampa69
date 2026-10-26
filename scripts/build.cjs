/* Build Lampa from its pinned source, preserving its public plugin API. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const {createRequire} = require('node:module');
const ROOT = path.resolve(__dirname, '..');
const SOURCE_SHA = '616c80224518a7c7e04e2789d5811881b93bf611';
const upstream = path.resolve(process.env.LAMPA_SOURCE || path.join(ROOT, '.upstream'));
const out = path.join(ROOT, 'dist');
const version = require('../package.json').version;
async function main() {
    if (cp.execFileSync('git', ['rev-parse', 'HEAD'], {cwd: upstream, encoding: 'utf8'}).trim() !== SOURCE_SHA) throw Error('Unexpected Lampa source revision');
    const load = createRequire(path.join(upstream, 'package.json'));
    const {rollup} = load('rollup');
    const {babel} = load('@rollup/plugin-babel');
    const commonjs = load('@rollup/plugin-commonjs');
    const resolve = load('@rollup/plugin-node-resolve').nodeResolve;
    const worker = load('rollup-plugin-web-worker-loader');
    const sass = load('sass');
    const postcss = load('postcss');
    const autoprefixer = load('autoprefixer');
    fs.rmSync(out, {recursive: true, force: true});
    fs.mkdirSync(out, {recursive: true});
    fs.cpSync(path.join(upstream, 'public'), path.join(out, 'app'), {recursive: true});
    const bundle = await rollup({
        input: path.join(upstream, 'src/app.js'),
        plugins: [{name: 'xott-tv-detection', transform(code, id) {
            if (!id.endsWith('/src/core/platform.js')) return null;
            const before = "return is('tizen') || is('webos') || is('orsay')";
            if (!code.includes(before)) throw Error('TV detection patch no longer matches upstream');
            return {code: code.replace(before, "return Boolean(window.XOTT_TV) || is('tizen') || is('webos') || is('orsay')"), map: null};
        }}, babel({babelHelpers: 'bundled', presets: [[load.resolve('@babel/preset-env'), {targets: {ie: '11'}, modules: false}]]}), commonjs(), resolve(), worker()],
        onwarn(warning, warn) { if (!['CIRCULAR_DEPENDENCY', 'THIS_IS_UNDEFINED', 'EVAL'].includes(warning.code)) warn(warning); }
    });
    const generated = await bundle.generate({format: 'iife'});
    await bundle.close();
    let code = generated.output.find(file => file.type === 'chunk' && file.isEntry).code;
    const hash = crypto.createHash('sha256').update(code).digest('hex');
    code = code.replace(/return kIsNodeJS/g, 'return false').replace('{__APP_HASH__}', hash).replace('{__APP_BUILD__}', 'XOTT TV ' + version);
    fs.writeFileSync(path.join(out, 'app/app.min.js'), code);
    for (const file of generated.output) {
        if (!(file.type === 'chunk' && file.isEntry)) {
            const target = path.join(out, 'app', file.fileName);
            fs.mkdirSync(path.dirname(target), {recursive: true});
            fs.writeFileSync(target, file.type === 'asset' ? file.source : file.code);
        }
    }
    for (const file of fs.readdirSync(path.join(upstream, 'src/sass')).filter(name => name.endsWith('.scss') && !name.startsWith('_'))) {
        const result = sass.renderSync({file: path.join(upstream, 'src/sass', file), quietDeps: true});
        const prefixed = await postcss([autoprefixer({overrideBrowserslist: ['last 100 versions', '> 1%', 'ie 8', 'ios 6', 'android 4']})]).process(result.css.toString(), {from: undefined});
        fs.writeFileSync(path.join(out, 'app/css', file.replace(/\.scss$/, '.css')), prefixed.css);
    }
    fs.cpSync(path.join(upstream, 'src/lang'), path.join(out, 'app/lang'), {recursive: true});
    for (const file of ['index.html', 'bootstrap.js', 'xott.css']) fs.writeFileSync(path.join(out, 'app', file), fs.readFileSync(path.join(ROOT, 'app', file), 'utf8').replace(/__VERSION__/g, version));
    fs.mkdirSync(path.join(out, 'app/plugins'), {recursive: true});
    fs.writeFileSync(path.join(out, 'app/plugins/modification.js'), fs.readFileSync(path.join(ROOT, 'app/modification.js'), 'utf8').replace(/__VERSION__/g, version));
    fs.writeFileSync(path.join(out, 'app/plugins_black_list.json'), '[]\n');
    /* Deployment base may include a project subdirectory, e.g. /lampa69/. */
    const base = (process.env.SITE_URL || 'https://xott69.github.io/lampa69/').replace(/\/?$/, '/');
    if (!/^https?:\/\//.test(base)) throw Error('SITE_URL must be an absolute HTTP(S) URL');
    fs.mkdirSync(path.join(out, 'msx'), {recursive: true});
    fs.writeFileSync(path.join(out, 'msx/start.json'), JSON.stringify({name: 'XOTT TV', version, parameter: 'content:' + base + 'msx/start.json', action: 'link:' + base + 'app/'}, null, 2));
    fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><html lang="uk"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=app/"><title>XOTT TV</title><a href="app/">Відкрити XOTT TV</a></html>');
    fs.writeFileSync(path.join(out, '.nojekyll'), '');
    fs.copyFileSync(path.join(upstream, 'LICENSE'), path.join(out, 'LICENSE-Lampa.txt'));
    fs.mkdirSync(path.join(out, 'source'), {recursive: true});
    cp.execFileSync('git', ['archive', '--format=tar.gz', '--output=' + path.join(out, 'source/lampa-source.tar.gz'), SOURCE_SHA], {cwd: upstream});
    fs.copyFileSync(path.join(upstream, 'package-lock.json'), path.join(out, 'source/package-lock.json'));
    fs.writeFileSync(path.join(out, 'build.json'), JSON.stringify({version, upstream: SOURCE_SHA, upstreamURL: 'https://github.com/yumata/lampa-source', source: 'source/lampa-source.tar.gz', customization: 'https://github.com/XOTT69/lampa69', appSHA256: crypto.createHash('sha256').update(code).digest('hex')}, null, 2));
    console.log('Built XOTT TV ' + version + ' at ' + base);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
