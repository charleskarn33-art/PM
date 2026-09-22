#!/usr/bin/env bash
# Downloads the PostgREST binary used by the API integration tests (pnpm test:db).
# Supabase runs PostgREST 12.x; keep this in step with the hosted version.
set -euo pipefail
VERSION="${POSTGREST_VERSION:-v12.2.12}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/.tools"
mkdir -p "$DEST"
if [[ -x "$DEST/postgrest" ]] && "$DEST/postgrest" --version | grep -q "${VERSION#v}"; then
  echo "PostgREST ${VERSION} already present"; exit 0
fi
curl -fsSL "https://github.com/PostgREST/postgrest/releases/download/${VERSION}/postgrest-${VERSION}-linux-static-x86-64.tar.xz" \
  | tar -xJ -C "$DEST"
"$DEST/postgrest" --version
