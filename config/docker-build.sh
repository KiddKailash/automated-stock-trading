#!/bin/bash

# Magic Formula Trader - Docker Build Script
# Builds Docker image for the application

set -e

echo "🐳 Building Docker image for Magic Formula Trader..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Default image name and tag
IMAGE_NAME=${1:-magic-formula-trader}
IMAGE_TAG=${2:-latest}
FULL_IMAGE_NAME="$IMAGE_NAME:$IMAGE_TAG"

echo "📦 Building image: $FULL_IMAGE_NAME"

# Build the Docker image
docker build -t "$FULL_IMAGE_NAME" .

echo "✅ Docker image built successfully!"
echo ""
echo "To run the container:"
echo "  docker run -p 3000:3000 --env-file .env $FULL_IMAGE_NAME"
echo ""
echo "Or use Docker Compose:"
echo "  docker-compose up -d"
echo ""
echo "To push to registry:"
echo "  docker push $FULL_IMAGE_NAME"
echo "" 