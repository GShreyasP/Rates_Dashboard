#!/usr/bin/env bash
# exit on error
set -o errexit

# Install Python Dependencies
pip install -r Backend/requirements.txt

# Build Frontend
cd Frontend/frontend
npm install
npm run build
cd ../..

# Copy frontend build to Backend/dist so Flask can serve it
echo "Copying frontend build to Backend/dist..."
mkdir -p Backend/dist
cp -r Frontend/frontend/dist/* Backend/dist/