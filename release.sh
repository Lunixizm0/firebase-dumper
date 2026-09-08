#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?Kullanım: ./release.sh 5.1.0}"
TAG="v${VERSION}"
PACKAGE_NAME="firebase-dump"

echo "package.json güncelleniyor..."
sed -i "s/^  \"version\": \".*/  \"version\": \"${VERSION}\",/" package.json

echo "Testler çalıştırılıyor..."
npm test

echo "Lint kontrol ediliyor..."
npm run lint

echo "TypeScript kontrol ediliyor..."
npm run typecheck

echo "Build ediliyor..."
npm run build

echo "Commit ediliyor..."
git add package.json
git diff --cached --quiet || git commit -m "release: ${TAG}"

echo "Tag oluşturuluyor..."
git tag -f "${TAG}"

echo "Push ediliyor..."
git push origin main "${TAG}" --force

echo "GitHub Release oluşturuluyor..."
gh release delete "${TAG}" --yes --cleanup-tag 2>/dev/null || true
gh release create "${TAG}" \
  --title "${TAG}" \
  --generate-notes

echo ""
echo "${TAG} yayınlandı! npm'e yükleniyor..."

echo "npm publish..."
npm publish --access public

echo ""
echo "${TAG} npm'e yüklendi!"
echo "https://github.com/Lunixizm0/firebase-dumper/actions"
echo "https://www.npmjs.com/package/${PACKAGE_NAME}/v/${VERSION}"

echo ""
echo "npm üzerinde ${VERSION} versiyonu bekleniyor..."

NPM_URL="https://registry.npmjs.org/${PACKAGE_NAME}/${VERSION}"
MAX_ATTEMPTS=30
SLEEP_SECONDS=5

for ((i=1; i<=MAX_ATTEMPTS; i++)); do
    HTTP_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" "$NPM_URL")

    if [[ "$HTTP_STATUS" == "200" ]]; then
        echo "+ ${VERSION} npm'de mevcut"
        echo "https://www.npmjs.com/package/${PACKAGE_NAME}/v/${VERSION}"
        exit 0
    fi

    echo " Henüz mevcut değil (HTTP ${HTTP_STATUS}). ${SLEEP_SECONDS}s bekleniyor... [$i/$MAX_ATTEMPTS]"
    sleep "$SLEEP_SECONDS"
done

echo ""
echo "${VERSION} ${MAX_ATTEMPTS} denemeden sonra npm'de bulunamadı."
echo "GitHub Actions'ı kontrol et:"
echo "https://github.com/Lunixizm0/firebase-dumper/actions"

exit 1