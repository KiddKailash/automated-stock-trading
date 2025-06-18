#!/bin/bash

# Magic Formula Trader - Build Script
# Prepares the application for deployment

set -e

echo "🔨 Building Magic Formula Trader..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm ci

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p logs database config

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Copying template..."
    if [ -f env-template.txt ]; then
        cp env-template.txt .env
        echo "📋 Environment template copied to .env"
        echo "⚠️  Please edit .env file with your actual API keys and configuration!"
    else
        echo "❌ Environment template not found. Please create .env file manually."
        exit 1
    fi
fi

# Validate environment file
echo "🔍 Validating environment configuration..."
if grep -q "your_.*_here" .env; then
    echo "⚠️  WARNING: .env file contains placeholder values. Please update with real values!"
fi

# Run a quick test to ensure the application can start
echo "🧪 Testing application startup..."
timeout 10s npm run dev > /dev/null 2>&1 || {
    echo "⚠️  Application test startup failed. Please check your configuration."
}

echo "✅ Build completed successfully!"
echo ""
echo "Next steps:"
echo "1. Update .env file with your API keys and configuration"
echo "2. Run 'npm run dev' for development"
echo "3. Run 'npm start' for production"
echo "4. Run 'npm run docker:build' to build Docker image"
echo "" 