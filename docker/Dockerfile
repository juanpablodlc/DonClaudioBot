FROM node:22-bookworm-slim

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    docker.io \
    git \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Install gog CLI for sandbox (Google OAuth)
RUN curl -L https://github.com/steipete/gogcli/releases/download/v0.8.0/gogcli_0.8.0_linux_amd64.tar.gz \
      | tar -xz -C /usr/local/bin && \
      chmod +x /usr/local/bin/gog

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY onboarding/package*.json ./onboarding/

# Install dependencies
# NOTE: OpenClaw uses pnpm, but this project uses npm
# For production: migrate to pnpm and use pnpm install --frozen-lockfile
RUN npm install --legacy-peer-deps
RUN cd onboarding && npm install --legacy-peer-deps

# Copy source code and build
COPY onboarding/src ./onboarding/src
COPY tsconfig.json ./
RUN npm run build

# Copy launcher and config
COPY launcher.js ./
COPY config ./config

# Copy entrypoint script
COPY docker/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Create non-root user and state directory
# Make idempotent for rebuilds
RUN groupadd -g 1000 appuser 2>/dev/null || true && \
    useradd -r -u 1000 -g appuser appuser 2>/dev/null || true && \
    mkdir -p /home/node/.openclaw && \
    chown -R 1000:1000 /home/node/.openclaw

# Environment
ENV NODE_ENV=production
ENV OPENCLAW_STATE_DIR=/home/node/.openclaw

# Expose ports
EXPOSE 3000 18789

# Health check (onboarding service)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run dual-process launcher (Gateway + Onboarding) via entrypoint
# Entrypoint ensures openclaw.json exists with correct dmScope (prevents sticky session bug)
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD []
