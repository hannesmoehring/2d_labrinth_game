FROM node:22-alpine

# better-sqlite3 compiles a native addon — needs Python + build tools
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install dependencies first (layer-cached unless package.json changes)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY server.js db.js generate-levels.js ./
COPY public/ public/

EXPOSE 3000

CMD node generate-levels.js 500 && node server.js
