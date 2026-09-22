#!/bin/bash
# 🌐 도도블록을 웹에 올린다.
#
#   ./publish.sh
#
# 게임(index.html) 하나만 올린다. server/ 나 README 는 안 올라간다.
# 처음 한 번은 Cloudflare 로그인이 필요하다:  npx wrangler login
set -e
cd "$(dirname "$0")"

rm -rf .site
mkdir .site
cp index.html .site/index.html

npx wrangler pages deploy .site \
  --project-name=dodoblock \
  --branch=main \
  --commit-dirty=true

echo
echo "다 올라갔어요. 위에 나온 https://…pages.dev 주소를 친구에게 보내면 됩니다."
