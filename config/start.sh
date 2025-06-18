#!/bin/bash

# Magic Formula Trader - Start Script
# Starts the application with proper environment setup

set -e

echo "🚀 Starting Magic Formula Trader..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ .env file not found. Please run build.sh first or create .env manually."
    echo "💡 You can copy env-template.txt to .env and update the values."
    exit 1
fi

# Check if node_modules exists
if [ ! -d node_modules ]; then
    echo "📦 Dependencies not installed. Installing now..."
    npm install
fi

# Create necessary directories
mkdir -p logs database config

# Set environment based on argument
ENVIRONMENT=${1:-production}

echo "🌍 Environment: $ENVIRONMENT"

# Start the application
if [ "$ENVIRONMENT" = "development" ] || [ "$ENVIRONMENT" = "dev" ]; then
    echo "🔧 Starting in development mode..."
    npm run dev
elif [ "$ENVIRONMENT" = "production" ] || [ "$ENVIRONMENT" = "prod" ]; then
    echo "🏭 Starting in production mode..."
    npm start
else
    echo "❌ Invalid environment. Use 'development' or 'production'"
    exit 1
fi 