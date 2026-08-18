#!/bin/bash
# Called by semantic-release with the next version.
# Bumps package.json and, in GitHub Actions, builds/pushes GHCR.

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <version>" >&2
  exit 1
fi

VERSION="$1"

node --input-type=module -e '
import { readFileSync, writeFileSync } from "fs";
const version = process.argv[1];
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
pkg.version = version;
writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
' "$VERSION"

echo "package.json set to ${VERSION}"

if [ -z "${GITHUB_ACTIONS:-}" ]; then
  echo "Not in CI — skip Docker push"
  exit 0
fi

IMAGE="${IMAGE_NAME:?IMAGE_NAME is required in CI (ghcr.io/owner/repo)}"
IMAGE="$(echo "$IMAGE" | tr '[:upper:]' '[:lower:]')"
OWNER="${GITHUB_REPOSITORY_OWNER:-}"
PKG="${IMAGE##*/}"

docker_push() {
  local tag="$1"
  local i
  for i in 1 2 3 4 5; do
    docker push "$tag" && return 0
    echo "docker push failed (attempt $i), retry in 15s" >&2
    sleep 15
  done
  echo "docker push timed out: $tag" >&2
  return 1
}

docker build -t "${IMAGE}:${VERSION}" .
docker_push "${IMAGE}:${VERSION}"

if [[ "$VERSION" == *-* ]]; then
  docker tag "${IMAGE}:${VERSION}" "${IMAGE}:dev"
  docker_push "${IMAGE}:dev"
else
  docker tag "${IMAGE}:${VERSION}" "${IMAGE}:latest"
  docker_push "${IMAGE}:latest"
fi

# First GHCR package is private. Public = Watchtower on the server can pull
# without a login. Ignore errors if the package is already public.
if command -v gh >/dev/null && [ -n "${GITHUB_TOKEN:-}" ] && [ -n "$OWNER" ]; then
  gh api --method PATCH "/user/packages/container/${PKG}" -f visibility=public \
    || gh api --method PATCH "/orgs/${OWNER}/packages/container/${PKG}" -f visibility=public \
    || true
fi

echo "Pushed ${IMAGE}:${VERSION}"
