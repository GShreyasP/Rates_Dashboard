#!/bin/bash
# Build script for Render - builds frontend and copies to Backend
set -e

echo "Building frontend..."
cd ../Frontend/frontend
npm install
npm run build

echo "Copying frontend build to Backend directory..."
cd ../../Backend
mkdir -p dist
cp -r ../Frontend/frontend/dist/* dist/

echo "Build complete!"




