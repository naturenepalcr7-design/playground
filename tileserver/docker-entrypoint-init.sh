#!/bin/bash
set -e

# Ensure /data directory exists
mkdir -p /data

# If /data/config.json does not exist in the volume, copy the default template
if [ ! -f /data/config.json ]; then
    echo "[TileServer-Init] No config.json found in /data volume. Initializing from default template..."
    cp /default-config.json /data/config.json
fi

# Ensure /data and its contents are owned by node user and readable/writable by both node and root
chown -R node:node /data 2>/dev/null || true
chmod -R 775 /data 2>/dev/null || true

# Execute original TileServer entrypoint as user node
exec runuser -u node -- /usr/src/app/docker-entrypoint.sh "$@"
