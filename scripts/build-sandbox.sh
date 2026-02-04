#!/bin/bash
set -e

IMAGE_NAME="openclaw-sandbox:bookworm-slim"
DOCKERFILE="config/sandbox/Dockerfile.sandbox"

# Must run from project root (COPY paths are relative to build context)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo "Building sandbox image: ${IMAGE_NAME}..."
docker build -f "$DOCKERFILE" -t "$IMAGE_NAME" .
echo "Sandbox image built successfully: ${IMAGE_NAME}"
echo "Verify with: docker run --rm ${IMAGE_NAME} gog --version"
