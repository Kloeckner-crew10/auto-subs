#!/bin/zsh
# Build and publish a crew10 release of AutoSubs (macOS, Apple Silicon).
#
#   scripts/release-crew10.sh            build, package and publish
#   scripts/release-crew10.sh --no-build package and publish an existing build
#
# Needs: Rust (rustup), cmake, gh (logged in), the updater key at
# ~/.tauri/crew10-autosubs.key and ffmpeg at src-tauri/binaries/.
# Bump the version first: npm run bump-version -- <x.y.z>
set -euo pipefail

APP_DIR="${0:A:h:h}"
REPO_ROOT="${APP_DIR:h}"
REPO="Kloeckner-crew10/auto-subs"
KEY="$HOME/.tauri/crew10-autosubs.key"
SDK="/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk"

cd "$APP_DIR"
VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}-crew10"
BUNDLE="src-tauri/target/release/bundle/macos"
OUT="$REPO_ROOT/release-out"
mkdir -p "$OUT"

if [[ "${1:-}" != "--no-build" ]]; then
  export PATH="/opt/homebrew/opt/rustup/bin:$PATH"
  # Command Line Tools may ship an SDK their own linker cannot read.
  if [[ -d "$SDK" ]]; then
    export SDKROOT="$SDK"
    export CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER="$APP_DIR/scripts/cc-sdk265.sh"
  fi
  # Portable CPU code: runs on every Apple Silicon Mac, not just this one.
  export CFLAGS=-U__ARM_FEATURE_MATMUL_INT8 CXXFLAGS=-U__ARM_FEATURE_MATMUL_INT8
  # whisper-rs-sys forwards GGML_*/CMAKE_* environment variables to CMake.
  export GGML_NATIVE=OFF GGML_I8MM=OFF CMAKE_OSX_DEPLOYMENT_TARGET=13.3
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY")" TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
  npm run tauri build -- -- --no-default-features --features mac-aarch
fi

# Installer (.pkg) with the same postinstall as the official one: it writes
# the Resolve launcher script for the logged-in user.
STAGE="$(mktemp -d)"
mkdir -p "$STAGE/Payload"
cp -R "$BUNDLE/AutoSubs.app" "$STAGE/Payload/"
chmod +x "$REPO_ROOT/Mac-Package/Scripts/"*
# Not relocatable: always install to /Applications, even when another copy
# with the same bundle id (e.g. the build output) exists elsewhere.
pkgbuild --analyze --root "$STAGE/Payload" "$STAGE/component.plist" >/dev/null
plutil -replace 0.BundleIsRelocatable -bool NO "$STAGE/component.plist"
pkgbuild --identifier com.tom-moroney.autosubs \
  --version "$VERSION" \
  --install-location /Applications \
  --root "$STAGE/Payload" \
  --component-plist "$STAGE/component.plist" \
  --scripts "$REPO_ROOT/Mac-Package/Scripts" \
  "$OUT/AutoSubs-crew10-Mac-ARM.pkg"
rm -rf "$STAGE"

# Updater artefacts: the signed app archive and latest.json for the in-app updater.
cp "$BUNDLE/AutoSubs.app.tar.gz" "$OUT/AutoSubs-macos-aarch64.app.tar.gz"
cp "$BUNDLE/AutoSubs.app.tar.gz.sig" "$OUT/AutoSubs-macos-aarch64.app.tar.gz.sig"
SIG="$(cat "$OUT/AutoSubs-macos-aarch64.app.tar.gz.sig")"
node -e '
const [version, sig, tag, repo] = process.argv.slice(1);
const json = {
  version,
  notes: "crew10-Version " + version,
  pub_date: new Date().toISOString(),
  platforms: {
    "darwin-aarch64": {
      signature: sig,
      url: `https://github.com/${repo}/releases/download/${tag}/AutoSubs-macos-aarch64.app.tar.gz`,
    },
  },
};
require("fs").writeFileSync(process.argv[5], JSON.stringify(json, null, 2) + "\n");
' "$VERSION" "$SIG" "$TAG" "$REPO" "$OUT/latest.json"

gh release create "$TAG" \
  --repo "$REPO" \
  --target crew10 \
  --title "AutoSubs crew10 $VERSION" \
  --notes "Installieren: AutoSubs-crew10-Mac-ARM.pkg laden und doppelklicken. Blockiert macOS die Datei: Systemeinstellungen → Datenschutz & Sicherheit → ganz unten „Dennoch öffnen“. Danach in Resolve Workspace → Scripts → AutoSubs. Details: CREW10.md" \
  --latest \
  "$OUT/AutoSubs-crew10-Mac-ARM.pkg" \
  "$OUT/AutoSubs-macos-aarch64.app.tar.gz" \
  "$OUT/AutoSubs-macos-aarch64.app.tar.gz.sig" \
  "$OUT/latest.json"

echo "Published https://github.com/$REPO/releases/tag/$TAG"
