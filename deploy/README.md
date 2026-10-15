# XOTT Online — налаштування власного VPS (Ubuntu 24.04)

Підходить для OVHcloud VPS-1 (2 vCore / 4 GB), OVHcloud VPS-2 (4 vCore / 8 GB) та інших x86_64/ARM64 VPS із публічною IPv4-адресою. Docker Compose запускає Lampac NextGen за Caddy HTTPS. Сервер **не купується автоматично**: його має замовити власник акаунта.

## 1. Замовити VPS

На https://www.ovhcloud.com/en-ie/vps/ вибрати VPS-1 для тесту, якщо 4 ГБ RAM; або VPS-2 для більшої кількості джерел та Chromium. Перевірити актуальну ціну, строк оплати, країну та ПДВ у кошику. Для першого тесту не купувати наперед на рік, якщо є помісячна оплата.

Параметри:
- Ubuntu 24.04 LTS **64-bit**, без платних панелей адміністрування.
- Публічна IPv4.
- Увімкнути SSH; пароль чи приватний ключ не публікувати.
- Локація: Європа (наприклад Франція/Польща/Німеччина, залежно від доступності).

## 2. Налаштування доступу

Після створення VPS провайдер повідомить публічну IP та логін. Відкрити SSH у терміналі (логін може бути ubuntu або інший згідно повідомлення OVH):

```bash
ssh ubuntu@PUBLIC_IP
```

Якщо провайдер видав ключ SSH, використовувати `ssh -i ~/.ssh/my_key ubuntu@PUBLIC_IP`. При першому вході оновити пароль, налаштувати доступ та перевірити правила VPS firewall. Дозволити вхідні TCP **22** (бажано лише зі своєї IP), **80**, **443**. **9118 не відкривати** у зовнішній мережі.

## 3. DNS Cloudflare

У зоні `xottspace.pp.ua` створити **A-запис**:
- Name: `watch`
- IPv4 address: публічна адреса VPS
- Proxy status: **DNS only** для запуску й HTTPS-перевірки.

Це створить `watch.xottspace.pp.ua`. Не змінювати DNS сайту `xottspace.pp.ua`.

## 4. Розгортання

На VPS після входу під користувачем з доступом sudo:

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/XOTT69/lampa69.git
cd lampa69
bash deploy/setup.sh watch.xottspace.pp.ua
```

Скрипт встановить Docker та Compose, запропонує створити **локальний пароль адміністратора** (16+ символів), запустить контейнер Lampac і Caddy. Пароль зберігається лише на VPS у `deploy/runtime/passwd` (цей каталог у .gitignore). Не публікувати пароль та SSH-ключі. Якщо команда `git clone` повідомляє що каталог існує, зайти до нього й виконати `git pull`.

## 5. Перевірка

```bash
cd ~/lampa69/deploy
sudo docker compose ps
sudo docker compose logs --tail=80
curl -fsS -I https://watch.xottspace.pp.ua/on.js
```

Якщо є HTTPS-відповідь і JavaScript, модуль завантажується. Якщо сертифікат не видався, перевірити A-запис Cloudflare і доступність TCP 80/443.

## 6. Підключення Lampa MX

Основний клієнт XOTT (із кнопкою **Онлайн**):
`https://cdn.jsdelivr.net/gh/XOTT69/lampa69@main/plugin.js`

У меню XOTT → **HDRezka та інші · Lampac** → вказати лише базову адресу `https://watch.xottspace.pp.ua`. XOTT підключає штатний Lampac-модуль `/on.js`, а не `/online.js`. Можна також додати напряму `https://watch.xottspace.pp.ua/on.js` як окремий плагін (щоб тестувати Lampac незалежно від XOTT).

Наявність фільмів, українських озвучок, якостей та доступність Filmix/HDRezka визначаються роботою й налаштуваннями провайдерів; сервер сам по собі не гарантує універсального безкоштовного доступу. Зважайте на умови провайдерів та авторські права.

## 7. Після запуску

Перевірити оновлення образів, поставити WAF/ліміти, не робити адміністративну панель публічною, контролювати RAM/CPU, використовувати лише дозволені модулі. У нашому конфізі ввімкнено `lowMemoryMode` для 4 GB, а Chromium залишається увімкненим для джерел, яким він потрібен. На VPS-1 при нестачі пам'яті перейдіть до VPS-2.

У репозиторії: `deploy/compose.yaml`, `deploy/Caddyfile`, `deploy/init.conf`, `deploy/setup.sh`.

Джерело: https://github.com/lampac-nextgen/lampac
