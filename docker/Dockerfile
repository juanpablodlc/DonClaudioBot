FROM node:22-bookworm-slim

# Install OpenClaw and dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

# Install gog CLI for sandbox
RUN curl -L https://github.com/steipete/gogcli/releases/download/v0.8.0/gogcli_0.8.0_linux_amd64.tar.gz \
      | tar -xz -C /usr/local/bin && \
    chmod +x /usr/local/bin/gog

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY onboarding/package*.json ./onboarding/

# Install dependencies
RUN npm ci --production
RUN cd onboarding && npm ci --production

# Install OpenClaw CLI globally
RUN npm install -g openclaw@latest && openclaw --version

# Copy source code
COPY onboarding/src ./onboarding/src
COPY tsconfig.json ./

# Build TypeScript
RUN npm run build

# Copy config templates
COPY config ./config

# Create non-root user and state directory
RUN groupadd -g 1000 appuser && \
    useradd -r -u 1000 -g appuser appuser && \
    mkdir -p /home/node/.openclaw && \
    chown -R appuser:appuser /home/node/.openclaw

# Environment
ENV NODE_ENV=production
ENV OPENCLAW_STATE_DIR=/home/node/.openclaw

# Expose ports
EXPOSE 3000 18789

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run both services (will use supervisord or similar in production)
CMD ["node", "onboarding/dist/index.js"]
