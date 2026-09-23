FROM node:22-alpine

# better-sqlite3 compiles a native addon — needs Python + build tools
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install dependencies first (layer-cached unless package.json changes)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY server.js db.js solver.js generate-levels.js entrypoint.sh ./
COPY public/ public/

RUN chmod +x entrypoint.sh

EXPOSE 3000

CMD ["sh", "entrypoint.sh"]
