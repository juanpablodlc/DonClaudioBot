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
RUN curl -L https://github.com/steipete/gogcli/releases/download/v0.9.0/gogcli_0.9.0_linux_amd64.tar.gz \
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

# TEMPORARY: Patch OpenClaw bindings hot-reload bug (PR #11372)
# Makes resolveAgentRoute() call loadConfig() fresh per-message instead of using stale startup snapshot
# Remove this once openclaw ships the fix upstream
RUN node -e "\
  const fs = require('fs'); \
  const glob = require('path'); \
  const dist = 'node_modules/openclaw/dist'; \
  const files = fs.readdirSync(dist).filter(f => f.startsWith('loader-') && f.endsWith('.js')); \
  if (files.length !== 1) { console.log('WARN: expected 1 loader file, found', files.length); process.exit(0); } \
  const f = dist + '/' + files[0]; \
  const src = fs.readFileSync(f, 'utf8'); \
  const marker = 'const route = resolveAgentRoute({'; \
  const target = 'cfg: params.cfg,'; \
  const replacement = 'cfg: loadConfig(),'; \
  const idx = src.indexOf('function createWebOnMessageHandler'); \
  if (idx === -1) { console.log('WARN: createWebOnMessageHandler not found'); process.exit(0); } \
  const routeIdx = src.indexOf(marker, idx); \
  if (routeIdx === -1) { console.log('WARN: resolveAgentRoute not found in handler'); process.exit(0); } \
  const cfgIdx = src.indexOf(target, routeIdx); \
  if (cfgIdx === -1 || cfgIdx > routeIdx + 200) { console.log('WARN: cfg: params.cfg not found near route call'); process.exit(0); } \
  const patched = src.slice(0, cfgIdx) + replacement + src.slice(cfgIdx + target.length); \
  fs.writeFileSync(f, patched); \
  console.log('Patched bindings hot-reload in', files[0]); \
"

# TEMPORARY: Patch shouldHandleTextCommands to honor commands.text: false on WhatsApp
# Bug: returns !isNativeCommandSurface(surface) — true for WhatsApp (not native), ignoring config
# Fix: return false when commands.text is explicitly false, regardless of surface type
# Remove this once openclaw ships the fix upstream
RUN node -e "\
  const fs = require('fs'); \
  const dist = 'node_modules/openclaw/dist'; \
  const files = fs.readdirSync(dist).filter(f => f.startsWith('channel-summary-') && f.endsWith('.js')); \
  if (files.length === 0) { console.error('ERROR: no channel-summary files found'); process.exit(1); } \
  let patched = 0; \
  for (const file of files) { \
    const f = dist + '/' + file; \
    const src = fs.readFileSync(f, 'utf8'); \
    const marker = 'function shouldHandleTextCommands(params)'; \
    const idx = src.indexOf(marker); \
    if (idx === -1) continue; \
    const target = '!isNativeCommandSurface(params.surface)'; \
    const targetIdx = src.indexOf(target, idx); \
    if (targetIdx === -1 || targetIdx > idx + 300) { console.error('ERROR: isNativeCommandSurface not found near shouldHandleTextCommands in', file); process.exit(1); } \
    const result = src.slice(0, targetIdx) + 'false' + src.slice(targetIdx + target.length); \
    fs.writeFileSync(f, result); \
    patched++; \
    console.log('Patched shouldHandleTextCommands in', file); \
  } \
  if (patched === 0) { console.error('ERROR: no files patched'); process.exit(1); } \
  console.log('Patched', patched, 'of', files.length, 'channel-summary files'); \
"

# Copy source code and build
COPY onboarding/src ./onboarding/src
COPY tsconfig.json ./
RUN npm run build

# Copy launcher and config
COPY launcher.js ./
COPY config ./config
COPY config/extensions /app/config/extensions

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
