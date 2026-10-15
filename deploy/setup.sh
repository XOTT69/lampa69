#!/usr/bin/env bash
# Run on your own Ubuntu 24.04 VPS (OVHcloud, Hetzner, etc.): bash deploy/setup.sh watch.your-domain.example
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: bash deploy/setup.sh watch.example.com"
  exit 1
fi

DOMAIN="$1"
if [[ ! "$DOMAIN" =~ ^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$ ]]; then
  echo "Error: enter a DNS hostname, not a URL or IP address."
  exit 1
fi

if ! command -v sudo >/dev/null 2>&1; then
  echo "This setup requires Ubuntu with sudo."
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "Installing Docker and Compose on Ubuntu..."
sudo apt-get update
sudo apt-get install -y software-properties-common ca-certificates curl
sudo add-apt-repository -y universe
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker

mkdir -p runtime
umask 077
if [[ ! -s runtime/passwd ]]; then
  read -r -s -p "Create a strong local Lampac admin password: " SECRET
  echo
  if [[ ${#SECRET} -lt 16 ]]; then
    echo "Password must contain at least 16 characters."
    exit 1
  fi
  printf '%s' "$SECRET" > runtime/passwd
  unset SECRET
  chmod 600 runtime/passwd
fi

printf 'XOTT_DOMAIN=%s\n' "$DOMAIN" > .env
chmod 600 .env

echo "Validating Docker Compose..."
sudo docker compose -f compose.yaml config --quiet

echo "Starting Lampac and Caddy..."
sudo docker compose -f compose.yaml pull
sudo docker compose -f compose.yaml up -d

echo
echo "Services created. HTTPS requires a DNS A record pointed to this server"
echo "and TCP ports 80/443 allowed in both Oracle Cloud network rules and VM firewall."
echo "When DNS is ready, verify: curl -I https://$DOMAIN/on.js"
echo "Lampa MX source URL: https://$DOMAIN/on.js"
echo "View logs: cd $ROOT && sudo docker compose -f compose.yaml logs --tail=100"
