#!/bin/bash
# 🌐 도도블록을 웹(https://dodoblock.pages.dev)에 올린다.
#
#   ./publish.sh              최신 게임을 받아서(main) 올린다  ← 보통은 이것만
#   ./publish.sh --here       지금 폴더에 있는 그대로 올린다(받지 않음)
#
# 하는 일
#   1) 인터넷 보관함의 main 을 이 폴더로 받아 온다 (다른 가지에 있어도 main 으로 옮김)
#   2) index.html 과 시작 화면 동영상(media/)을 .site/ 에 모은다
#   3) Cloudflare 에 올린다
#
# ⚠️ Cloudflare 의 "production branch" 이름은 claude/project-thread-md739t 로
#    정해져 있다. 그 이름으로 올려야 짧은 주소(dodoblock.pages.dev)에 뜬다.
#    예전에는 "지금 있는 가지 이름"으로 올려서, 다른 가지에서 올리면 아무도
#    안 보는 미리보기 자리로 가 버렸다. 이제는 항상 이 이름으로 올린다.
#
# 처음 한 번은 Cloudflare 로그인이 필요하다:  npx wrangler login
#
# 스크립트 전체를 { } 로 감쌌다: 1)에서 이 파일이 새것으로 바뀌어도
# 이미 읽어 둔 내용으로 끝까지 돈다.
{
set -e
cd "$(dirname "$0")"

LIVE_BRANCH="claude/project-thread-md739t"

if [ "$1" != "--here" ]; then
  echo "⬇️  최신 게임 받는 중 (main)..."
  git fetch origin main
  if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
    git checkout main
  fi
  git pull --ff-only origin main
fi

VERSION="$(git log -1 --format='%h · %cd' --date=format:'%Y-%m-%d %H:%M')"

rm -rf .site
mkdir .site
cp index.html .site/index.html
cp -R media .site/media          # 🎬 시작 화면 배경 동영상
echo "$VERSION" > .site/version.txt
# 브라우저가 예전 게임을 기억해 두지 말고 매번 새로 확인하게
cat > .site/_headers <<'EOF'
/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/version.txt
  Cache-Control: no-store
EOF

echo "🎮 올리는 판: $VERSION"
npx wrangler pages deploy .site \
  --project-name=dodoblock \
  --branch="$LIVE_BRANCH" \
  --commit-dirty=true

echo
echo "✅ 게임 주소:  https://dodoblock.pages.dev"
echo "   올라간 판 확인: https://dodoblock.pages.dev/version.txt  →  $VERSION"
exit 0
}
