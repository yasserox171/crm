FROM node:22-bookworm-slim

# whatsapp-web.js drives a real WhatsApp Web in headless Chromium through Puppeteer.
# The server is ARM64, where Chrome for Testing doesn't exist: use Debian's Chromium
# and keep Puppeteer on the release built for the same Chrome version (package.json
# "overrides"). A mismatch breaks DevTools protocol calls right after login.
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    CHROMIUM_PATH=/usr/bin/chromium \
    DATA_DIR=/data \
    NODE_ENV=production

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.js ./

# The linked-device session lives in /data (a named volume).
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3000
CMD ["node", "server.js"]
