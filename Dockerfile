# ── Build: Node from pixi.lock, npm dependencies from package-lock.json ──
FROM ghcr.io/prefix-dev/pixi:0.81.0-bookworm-slim AS build

WORKDIR /app

# Node toolchain first (layer-cached unless the pixi manifest or lock changes)
COPY pixi.toml pixi.lock ./
RUN pixi install --locked --environment default \
 && pixi install --locked --environment build

# better-sqlite3 compiles its native addon with the build env's compilers
COPY package*.json ./
RUN pixi run --locked --environment build npm ci --omit=dev

# ── Runtime: pixi and the default env, without the compilers ──
FROM ghcr.io/prefix-dev/pixi:0.81.0-bookworm-slim

WORKDIR /app

COPY pixi.toml pixi.lock ./
COPY --from=build /app/.pixi/envs/default .pixi/envs/default
COPY --from=build /app/node_modules node_modules

# Copy application source
COPY server.js db.js solver.js generate-levels.js ./
COPY public/ public/

EXPOSE 3000

# --as-is: use the env baked into the image; never re-solve or download at startup
CMD ["pixi", "run", "--as-is", "start"]
