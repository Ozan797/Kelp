#!/bin/sh
set -e

binary="$1"
shift

identity="${KELP_DEV_SIGNING_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Apple Development:[^"]*\)".*/\1/p' | head -n 1)}"

if [ -n "$identity" ]; then
  codesign --force --sign "$identity" --identifier dev.ozanai.kelp "$binary" >/dev/null 2>&1 \
    || echo "dev-sign: couldn't sign $binary, running it unsigned" >&2
fi

exec "$binary" "$@"
