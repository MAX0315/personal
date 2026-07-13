#!/usr/bin/env bash
set -euo pipefail

SITE_ROOT="/var/www/anmaai.cn"
ARCHIVE="/tmp/anmaai-site.tar.gz"
NGINX_CONF="/tmp/anmaai.cn.conf"

if command -v dnf >/dev/null 2>&1; then
  sudo dnf install -y nginx
elif command -v yum >/dev/null 2>&1; then
  sudo yum install -y nginx
else
  echo "Neither dnf nor yum is available." >&2
  exit 1
fi

sudo mkdir -p "$SITE_ROOT"
sudo tar -xzf "$ARCHIVE" -C "$SITE_ROOT"
sudo cp "$NGINX_CONF" /etc/nginx/conf.d/anmaai.cn.conf

if id nginx >/dev/null 2>&1; then
  sudo chown -R nginx:nginx "$SITE_ROOT"
fi

sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx

echo "Deployed anmaai.cn to $SITE_ROOT"
