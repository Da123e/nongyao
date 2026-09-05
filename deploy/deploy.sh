#!/bin/bash
# ============================================================
# 金生链 · Ubuntu / Oracle ARM 一键部署脚本
# 用法： sudo bash deploy/deploy.sh
# 前置： 代码已 git clone 到 /home/ubuntu/nongyao
# 说明： 全程自动，装完直接输出访问地址。全程免费方案，不开任何付费服务。
# ============================================================

set -e

APP_DIR=/home/ubuntu/nongyao
WEB_ROOT=/var/www/nongyao
DB_NAME=nongyao
DB_USER=nongyao
DB_PASS=nongyao2026
SERVICE_USER=ubuntu

if [ "$EUID" -ne 0 ]; then
    echo "请用 sudo 运行： sudo bash deploy/deploy.sh"
    exit 1
fi

get_public_ip() {
    curl -s --max-time 5 ifconfig.me 2>/dev/null \
    || curl -s --max-time 5 icanhazip.com 2>/dev/null \
    || echo "127.0.0.1"
}

echo "==> [1/7] 安装系统依赖"
apt-get update -y
apt-get install -y python3-pip python3-venv python3-dev nginx mariadb-server \
                   libzbar0 git curl openssl build-essential

echo "==> [2/7] 安装 Node.js 20（前端构建用，系统自带的版本太旧）"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 18 ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi
echo "    Node 版本: $(node -v)"

echo "==> [3/7] 配置数据库"
systemctl enable --now mariadb
mysql -e "CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';"
mysql -e "GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';"
mysql -e "FLUSH PRIVILEGES;"

echo "==> [4/7] Python 虚拟环境与依赖"
cd "${APP_DIR}/backend"
python3 -m venv venv
./venv/bin/pip install --upgrade pip -i https://pypi.tuna.tsinghua.edu.cn/simple
./venv/bin/pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

echo "==> [5/7] 生成 .env（含随机密钥与公网 IP）"
if [ ! -f .env ]; then
    cp "${APP_DIR}/deploy/env.production.template" .env
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=mysql+pymysql://${DB_USER}:${DB_PASS}@localhost:3306/${DB_NAME}|" .env
    sed -i "s|^SECRET_KEY=.*|SECRET_KEY=$(openssl rand -hex 32)|" .env
    PUBLIC_IP=$(get_public_ip | tr -d '\n\r ')
    sed -i "s|^FRONTEND_URL=.*|FRONTEND_URL=http://${PUBLIC_IP}|" .env
    echo "    检测到公网 IP: ${PUBLIC_IP}"
else
    echo "    .env 已存在，跳过（如需重置请先删除 backend/.env）"
fi

echo "==> [6/7] 构建前端"
cd "${APP_DIR}/frontend"
npm install --no-audit --no-fund
npm run build
mkdir -p "${WEB_ROOT}"
rm -rf "${WEB_ROOT}/dist"
cp -r dist "${WEB_ROOT}/dist"

echo "==> [7/7] 配置并启动服务"
sed "s|^User=.*|User=${SERVICE_USER}|" "${APP_DIR}/deploy/nongyao.service" > /etc/systemd/system/nongyao.service
cp "${APP_DIR}/deploy/nginx.conf" /etc/nginx/sites-available/nongyao
ln -sf /etc/nginx/sites-available/nongyao /etc/nginx/sites-enabled/nongyao
rm -f /etc/nginx/sites-enabled/default
nginx -t

systemctl daemon-reload
systemctl enable nongyao nginx
systemctl restart nongyao
systemctl restart nginx

sleep 6
echo ""
echo "=========================================="
PUBLIC_IP=$(get_public_ip | tr -d '\n\r ')
echo "  部署完成！"
echo "  访问地址： http://${PUBLIC_IP}"
echo "  默认账号： admin / admin123"
echo ""
echo "  看后端日志： sudo journalctl -u nongyao -f"
echo "  重启后端：   sudo systemctl restart nongyao"
echo "=========================================="
