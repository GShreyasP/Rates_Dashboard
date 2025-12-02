#!/bin/bash
# Copy built files from Frontend/frontend/dist to root public directory
cp -r Frontend/frontend/dist/* public/ 2>/dev/null || mkdir -p public && cp -r Frontend/frontend/dist/* public/

