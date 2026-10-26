/* One-time Telegram webhook setup. Read secrets from local environment only. */
const {BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, API_URL} = process.env;
if (!BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET || !API_URL || !API_URL.startsWith('https://')) {
    console.error('Set BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and HTTPS API_URL locally. Never commit secrets.'); process.exit(1);
}
if (!/^[A-Za-z0-9_-]{16,256}$/.test(TELEGRAM_WEBHOOK_SECRET)) { console.error('Webhook secret must contain 16–256 A–Z/a–z/0–9/_/- characters'); process.exit(1); }
async function call(method, body) {
    const response = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/' + method, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
    const result = await response.json();
    if (!result.ok) throw new Error('Telegram rejected ' + method + ': ' + (result.description || response.status));
    return result.result;
}
try {
    await call('setWebhook', {url: API_URL.replace(/\/$/, '') + '/telegram', secret_token: TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query']});
    await call('setMyCommands', {commands: [{command: 'start', description: 'Вхід у XOTT TV за кодом'}, {command: 'logoutall', description: 'Вийти з усіх пристроїв'}]});
    console.log('Telegram webhook and Ukrainian bot menu configured.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
