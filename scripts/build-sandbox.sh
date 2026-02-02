#!/bin/bash
set -e
IMAGE_NAME='openclaw-sandbox:bookworm-slim'
DOCKERFILE='config/sandbox/Dockerfile.sandbox'
echo 'Building sandbox image: $IMAGE_NAME...'
docker build -f "$DOCKERFILE" -t "$IMAGE_NAME" .
echo 'Sandbox image built successfully: $IMAGE_NAME'
echo 'To verify: docker run --rm $IMAGE_NAME gog --version'
