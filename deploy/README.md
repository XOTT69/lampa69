# XOTT Online: безкоштовний сервер на Oracle Cloud

Мета: власний HTTPS-бекенд Lampac для Lampa MX. **Створення VM та DNS-запису користувач виконує у своїх акаунтах.** Ми не зберігаємо ключі, паролі та токени в GitHub.

## 1. Oracle Cloud Always Free
- Compute → Instances → Create instance
- Ubuntu 24.04 ARM64, shape **VM.Standard.A1.Flex**, **2 OCPU / 12 GB RAM**, boot volume **50 GB**.
- Public IPv4: увімкнути. Додати свій SSH public key; приватний ключ нікому не надсилати.
- Переконатися, що інстанс **Always Free-eligible** перед підтвердженням. У домашньому регіоні місця може не бути.

## 2. Мережа
- У VCN security list/NSG дозволити вхідні TCP **80** і **443** з інтернету.
- SSH TCP **22** краще обмежити своєю IP-адресою.
- **Не відкривати 9118** — Lampac доступний лише через контейнер Caddy.
- Якщо увімкнений UFW: `sudo ufw allow 80/tcp && sudo ufw allow 443/tcp`; не відрізайте SSH.

## 3. DNS (Cloudflare)
Створити запис **A**: ім'я `watch`, значення — публічна IPv4-адреса VM. Для першої перевірки режим **DNS only** (без помаранчевої хмарки). Приклад: `watch.xottspace.pp.ua`. Не змінюйте записи основного сайту.

## 4. SSH до VM
На своєму комп'ютері:
```bash
ssh -i ~/.ssh/oracle_key ubuntu@PUBLIC_IP
```
Шлях до ключа й IP замінити своїми. На VM:
```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/XOTT69/lampa69.git
cd lampa69
bash deploy/setup.sh watch.xottspace.pp.ua
```
Команда попросить **пароль адміністратора** (щонайменше 16 символів). Він зберігається тільки на VM у `deploy/runtime/passwd` і не завантажується до GitHub.

## 5. Перевірка
Після готовності DNS:
```bash
curl -I https://watch.xottspace.pp.ua/online.js
cd ~/lampa69/deploy
sudo docker compose -f compose.yaml ps
sudo docker compose -f compose.yaml logs --tail=100
```
У Lampa MX → Плагіни додати адресу `https://watch.xottspace.pp.ua/online.js`, **або** у XOTT Online → HDRezka та інші · Lampac ввести `https://watch.xottspace.pp.ua`.

Доступні Filmix/HDRezka та інші джерела залежать від налаштувань, правил, автентифікації й геообмежень провайдера. Не гарантовано наявності конкретних нових фільмів чи безкоштовного перегляду.

## 6. Безпека
- HTTPS через Caddy; контейнер Lampac не публікує TCP 9118.
- Заблоковано типові адміністративні маршрути на рівні Caddy; **це не повноцінна автентифікація**. Перевірте WAF/ліміти Lampac перед публічним використанням.
- Не підключати сторонні модулі без перевірки. Не зберігати токени або SSH-ключі у репозиторії.
- Оновлення: `cd ~/lampa69 && git pull && cd deploy && sudo docker compose -f compose.yaml pull && sudo docker compose -f compose.yaml up -d`.

Залежності: [Lampac NextGen](https://github.com/lampac-nextgen/lampac), [Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).
