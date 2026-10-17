#!/usr/bin/env bash
# Builds the extension into dist/:
#   elfalingo-extension-<version>.zip   upload this to the Chrome Web Store
#   elfalingo-extension-<version>/      the same files unpacked — load it in
#                                       chrome://extensions → «Load unpacked»
#
#   ./build-dist.sh           build the version in extension/manifest.json
#   ./build-dist.sh patch     raise the version first: 1.0.0 → 1.0.1
#   ./build-dist.sh minor     1.0.1 → 1.1.0   (major likewise)
#   ./build-dist.sh 1.2.0     set an exact version
#
# The unit tests run before anything is packed; a failing test stops the
# build. The end-to-end test needs a live server and an account, so it is not
# part of the build — run `npm run e2e` before publishing.

set -euo pipefail
cd "$(dirname "$0")"

for tool in node zip; do
  command -v "$tool" >/dev/null || { echo "✘ $tool is required" >&2; exit 1; }
done

echo "▸ unit tests"
node --test --test-reporter=dot test/*.test.js

if [[ $# -gt 0 ]]; then
  node scripts/version.mjs "$1"
fi

version=$(node -p "require('./extension/manifest.json').version")
echo "▸ checking and packing $version"
node scripts/package.mjs

folder="dist/elfalingo-extension-${version}"
zip_path="${folder}.zip"
size=$(du -h "$zip_path" | cut -f1 | tr -d ' ')
sha=$(shasum -a 256 "$zip_path" | cut -d' ' -f1)
echo
echo "  for the store:   ${zip_path} (${size}, sha256 ${sha:0:16}…)"
echo "  to try locally:  $(pwd)/${folder}"
echo "                   chrome://extensions → Developer mode → Load unpacked"
