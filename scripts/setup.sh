#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "Configuring Git hooks..."
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/pre-push

echo "Setup complete."
