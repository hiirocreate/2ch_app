#!/usr/bin/env bash
# Gradle/Android Studio 不要の APK ビルド。
# 必要: JDK, aapt2, dalvik-exchange(dx), zipalign, apksigner, android-23 の android.jar
#   Ubuntu: apt install android-sdk-platform-23 android-sdk-build-tools dalvik-exchange apksigner zipalign
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(cd .. && pwd)
ANDROID_JAR=${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}
VERSION_NAME=$(node -p "require('$ROOT/package.json').version")
VERSION_CODE=${VERSION_CODE:-$(git -C "$ROOT" rev-list --count HEAD 2>/dev/null || echo 1)}
OUT=build
rm -rf "$OUT" && mkdir -p "$OUT"/{res,assets/www,classes}

# 1. Web アセット (サーバー専用ファイルは除外)
cp -r "$ROOT"/public/. "$OUT"/assets/www/
rm -f "$OUT"/assets/www/sw.js

# 2. リソース + マニフェスト
aapt2 compile --dir res -o "$OUT"/res/
aapt2 link -I "$ANDROID_JAR" --manifest AndroidManifest.xml -A "$OUT"/assets \
  --min-sdk-version 21 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  -o "$OUT"/unsigned.apk "$OUT"/res/*.flat

# 3. Java → dex
javac -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -nowarn -Xlint:-options \
  -d "$OUT"/classes $(find src -name '*.java')
dalvik-exchange --dex --min-sdk-version=21 --output="$OUT"/classes.dex "$OUT"/classes
(cd "$OUT" && zip -q unsigned.apk classes.dex)

# 4. 整列 + 署名 (鍵が無ければ生成。更新インストールには同じ鍵が必要なので保管すること)
KEYSTORE=${KEYSTORE:-release.keystore}
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "${KS_PASS:-matome123}" -keypass "${KS_PASS:-matome123}" \
    -alias matome -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=2ch_app" >/dev/null 2>&1
fi
zipalign -f -p 4 "$OUT"/unsigned.apk "$OUT"/aligned.apk
mkdir -p "$ROOT"/dist
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:${KS_PASS:-matome123}" --ks-key-alias matome \
  --out "$ROOT"/dist/2ch-matome.apk "$OUT"/aligned.apk
apksigner verify "$ROOT"/dist/2ch-matome.apk
echo "OK: dist/2ch-matome.apk"
