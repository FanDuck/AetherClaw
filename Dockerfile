# syntax=docker/dockerfile:1
FROM node:22-alpine

LABEL org.opencontainers.image.title="AetherClaw (灵爪)" \
      org.opencontainers.image.description="Cross-Platform Self-Evolving Autonomous AI Agent Framework" \
      org.opencontainers.image.source="https://github.com/FanDuck/AetherClaw" \
      org.opencontainers.image.licenses="MIT"

# Install bash & standard Linux diagnostic utilities for OpenClaw shell_exec tools
RUN apk add --no-cache bash procps coreutils curl

WORKDIR /app

# Copy application source
COPY package.json ./
COPY bin ./bin
COPY src ./src
COPY assets ./assets
COPY skills ./skills

# Ensure runtime directories exist and are writable
RUN mkdir -p /app/data /app/skills && chown -R node:node /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3721 \
    ALLOW_INSECURE_HTTP=true \
    SHELL=/bin/bash \
    AETHERCLAW_HOME=/app

USER node

EXPOSE 3721

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3721)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
