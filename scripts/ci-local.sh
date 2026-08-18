#!/bin/bash
# Same checks as .github/workflows/ci.yml (test job). Run before push.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== tsc =="
npx tsc --noEmit

echo "== unit =="
npm run test:unit

echo "== integration =="
npm run test:integration

echo "OK — same as GitHub CI tests."
