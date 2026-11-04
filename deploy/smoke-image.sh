#!/usr/bin/env bash
# Smoke-tests a built Track Studio image (CI: .github/workflows/deploy-config.yml, job "image").
#   deploy/smoke-image.sh track-studio:ci
# Starts it in production with throwaway secrets and an empty data folder (a fresh volume at /data, deleted after), waits for /healthz, checks the logo and
# fonts are in the image, seeds the reference tracks and fetches one track's link-preview card.
set -euo pipefail

image="${1:?usage: deploy/smoke-image.sh <image>}"
port="${SMOKE_PORT:-3000}"
HEALTH_TIMEOUT=60
base="http://127.0.0.1:${port}"
container="track-studio-smoke-$$"
work="$(mktemp -d)"

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "--- container logs" >&2
    docker logs "$container" >&2 || true
  fi
  docker rm -f -v "$container" >/dev/null 2>&1 || true
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT

# throwaway values, made here and never printed
SESSION_SECRET="$(openssl rand -hex 32)"
DISCOURSE_CONNECT_SECRET="$(openssl rand -hex 32)"
export SESSION_SECRET DISCOURSE_CONNECT_SECRET

docker run -d --name "$container" -p "127.0.0.1:${port}:3000" \
  -e NODE_ENV=production -e DEV_LOGIN=0 -e PORT=3000 -e HOST=0.0.0.0 \
  -e DATA_DIR=/data --mount type=volume,dst=/data \
  -e BASE_URL="$base" -e FORUM_URL=http://forum.invalid \
  -e SESSION_SECRET -e DISCOURSE_CONNECT_SECRET \
  "$image" >/dev/null

echo "waiting up to ${HEALTH_TIMEOUT}s for /healthz"
deadline=$((SECONDS + HEALTH_TIMEOUT))
until [ "$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' "$base/healthz")" = "200" ]; do
  if [ "$SECONDS" -ge "$deadline" ]; then echo "FAIL: /healthz didn't return 200 within ${HEALTH_TIMEOUT}s" >&2; exit 1; fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$container")" != "true" ]; then echo "FAIL: the container exited" >&2; exit 1; fi
  sleep 2
done
echo "ok: /healthz 200"

# the files the PNG previews and link-preview cards need (apps/server/src/card.ts, fonts.ts), and the web app's fonts
docker exec "$container" sh -ec '
  test -s /app/apps/web/src/brand/logo.svg
  for f in Inter-Regular Inter-SemiBold Oswald-Medium Oswald-SemiBold; do test -s "/app/apps/server/fonts/$f.ttf"; done
  ls /app/apps/web/dist/assets/inter-*.woff2 /app/apps/web/dist/assets/oswald-*.woff2
' || { echo "FAIL: logo or font files missing from the image" >&2; exit 1; }
echo "ok: logo and fonts present"

docker exec "$container" node dist/seed.js

# the track page's og:image is the card the forum fetches for link previews
track="7c002509-b640-5e9d-8e79-0ae336a2ae04" # reference/examples/club-a.rctrack.json
card="$(curl -fsS --max-time 30 "$base/t/$track" | grep -o '<meta property="og:image" content="[^"]*"' | sed 's/.*content="//; s/"$//; s/&amp;/\&/g' || true)"
case "$card" in
  "$base"/p/*/card.png*) ;;
  *) echo "FAIL: no card.png og:image on /t/$track (got '$card')" >&2; exit 1 ;;
esac
read -r code type < <(curl -s --max-time 30 -o "$work/card.png" -w '%{http_code} %{content_type}\n' "$card")
if [ "$code" != "200" ] || [ "${type%%;*}" != "image/png" ] || [ "$(head -c 4 "$work/card.png" | tail -c 3)" != "PNG" ]; then
  echo "FAIL: $card returned $code $type" >&2
  exit 1
fi
echo "ok: card.png 200 image/png ($(wc -c < "$work/card.png") bytes)"
