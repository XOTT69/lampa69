import {readFile,writeFile} from 'node:fs/promises';
const parts=await Promise.all(['src/source-client.js','src/legacy-online.js','src/lampa-ui.js'].map(p=>readFile(p,'utf8')));
await writeFile('plugin.js','/* XOTT Online v0.10.0 · generated from src/ · no Lumio code copied */\n'+parts.join('\n\n'));
console.log('Built standalone plugin.js');
