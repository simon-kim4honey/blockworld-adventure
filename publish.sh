#!/bin/bash
# 🌐 도도블록을 웹에 올린다.
#
#   ./publish.sh              지금 있는 가지 이름으로 올린다
#   ./publish.sh main         가지를 직접 정해서 올린다
#
# ⚠️ Cloudflare 의 "production branch" 와 같은 이름으로 올려야
#    https://dodoblock.pages.dev 에 뜬다. 다른 이름으로 올리면
#    아무도 안 보는 미리보기 자리에 올라간다.
#    지금 이 프로젝트의 production branch 는 claude/project-thread-md739t 다.
#
# 게임(index.html) 과 시작 화면 동영상(media/) 만 올린다.
# server/ 나 README 는 안 올라간다.
# 처음 한 번은 Cloudflare 로그인이 필요하다:  npx wrangler login
set -e
cd "$(dirname "$0")"

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"

rm -rf .site
mkdir .site
cp index.html .site/index.html
cp -R media .site/media          # 🎬 시작 화면 배경 동영상

echo "🌿 올리는 가지: $BRANCH"
npx wrangler pages deploy .site \
  --project-name=dodoblock \
  --branch="$BRANCH" \
  --commit-dirty=true

echo
echo "🎮 게임 주소:  https://dodoblock.pages.dev"
echo "   (1~2분 뒤에 새 내용이 보입니다)"
