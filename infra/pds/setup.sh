#!/usr/bin/env bash
# ローカル PDS 開発環境のセットアップスクリプト
# 実行: bash infra/pds/setup.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

if [ -f "$ENV_FILE" ]; then
  echo ".env はすでに存在します。上書きしますか? (y/N)"
  read -r answer
  if [ "$answer" != "y" ]; then
    echo "キャンセルしました"
    exit 0
  fi
fi

echo "シークレットを生成中..."

JWT_SECRET=$(openssl rand -hex 32)
ADMIN_PASSWORD=$(openssl rand -hex 16)

# secp256k1 秘密鍵を hex で生成
PLC_KEY=$(openssl ecparam -genkey -name secp256k1 -noout -outform DER 2>/dev/null \
  | tail -c +8 | head -c 32 | xxd -p -c 64)

cat > "$ENV_FILE" <<EOF
PDS_HOSTNAME=localhost
PDS_JWT_SECRET=$JWT_SECRET
PDS_ADMIN_PASSWORD=$ADMIN_PASSWORD
PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX=$PLC_KEY
EOF

echo ""
echo ".env を生成しました: $ENV_FILE"
echo ""
echo "管理者パスワード: $ADMIN_PASSWORD"
echo "(このパスワードはアカウント作成時に使用します)"
echo ""
echo "次のコマンドで PDS を起動してください:"
echo "  cd infra/pds && docker compose up -d"
echo ""
echo "起動確認:"
echo "  curl http://localhost:2583/xrpc/com.atproto.server.describeServer"
