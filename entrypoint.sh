#!/bin/sh
# Generate levels BEFORE the server starts.
#
# This must not run in the background: db.js seeds 8 levels the moment
# server.js starts, and `--if-empty` skips when it finds any level. If the
# server wins that race the deployment keeps 8 levels forever, and every
# shared link above #8 is dead.
#
# Only the very first boot pays for this. On every later restart --if-empty
# exits in under a second.
node generate-levels.js "${LEVEL_COUNT:-100}" --if-empty

exec node server.js
