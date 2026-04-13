#!/bin/sh
# Start the server immediately so nginx never sees a 502 on boot.
# Generate levels in the background — only runs when the DB is empty
# (first boot). On every subsequent restart this exits in under a second.
node generate-levels.js "${LEVEL_COUNT:-100}" --if-empty &

exec node server.js
