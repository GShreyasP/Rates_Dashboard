#!/usr/bin/env bash
# exit on error
set -o errexit

# Install Python Dependencies
pip install -r Backend/requirements.txt

# Build Frontend
cd Frontend/frontend
npm install
npm run build
cd ../..`