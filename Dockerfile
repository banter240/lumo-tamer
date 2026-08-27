# Lightweight Dockerfile for lumo-tamer (no browser dependencies)
# If needed, connects to remote browser via CDP, instead of bundling Chrome

# ============================================================================
# Base stage - minimal Node.js dependencies only
# ============================================================================
FROM node:22-alpine AS base

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# ============================================================================
# Go builder stage - compile static Go binary
# ============================================================================
FROM golang:1.25-alpine AS go-builder

WORKDIR /build
# proxy.golang.org flakes in GHA with HTTP/2 INTERNAL_ERROR on zip downloads.
ENV GOPROXY=https://proxy.golang.org,direct
ENV GODEBUG=http2client=0

COPY src/auth/login/go/go.mod src/auth/login/go/go.sum ./
RUN set -eu; \
    i=1; \
    while [ "$i" -le 5 ]; do \
      echo "go mod download (attempt $i)"; \
      if go mod download; then exit 0; fi; \
      echo "go mod download failed (attempt $i), retry in 10s"; \
      i=$((i + 1)); \
      sleep 10; \
    done; \
    echo "go mod download failed after 5 attempts"; \
    exit 1

COPY src/auth/login/go ./
# CGO_ENABLED=0 produces a static binary - runs on Alpine, Debian, or native
RUN set -eu; \
    i=1; \
    while [ "$i" -le 5 ]; do \
      echo "go build (attempt $i)"; \
      if CGO_ENABLED=0 go build -o proton-auth; then exit 0; fi; \
      echo "go build failed (attempt $i), retry in 10s"; \
      i=$((i + 1)); \
      sleep 10; \
    done; \
    echo "go build failed after 5 attempts"; \
    exit 1

# ============================================================================
# Builder stage - compile TypeScript
# ============================================================================
FROM base AS builder

RUN apk add --no-cache python3 py3-setuptools make g++ libc6-compat \
    cairo-dev pango-dev jpeg-dev giflib-dev librsvg-dev

# Install all dependencies (including dev dependencies for building)
RUN npm ci

# Copy source code
COPY src ./src
COPY packages ./packages

# Build TypeScript, then prune dev dependencies
RUN npm run build && npm prune --production

# ============================================================================
# Final stage
# ============================================================================
FROM base


# Copy production node_modules and compiled TypeScript from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Copy config defaults (required at runtime)
COPY config.defaults.yaml ./

# Copy Go binary from go-builder
COPY --from=go-builder /build/proton-auth ./dist/proton-auth

# Make tamer available as command
RUN npm link



# Command aliases for tamer subcommands auth, server, cli
#   docker compose run --rm -it tamer auth
#   docker compose run --rm -it tamer server
#   docker compose run --rm -it tamer cli
ENTRYPOINT ["sh", "-c", "\
  case \"$1\" in \
    auth)   shift; exec tamer auth \"$@\" ;; \
    server) shift; exec tamer server \"$@\" ;; \
    cli)    shift; exec tamer \"$@\" ;; \
    '')     exec tamer server ;; \
    *)      exec \"$@\" ;; \
  esac", "--"]

# Expose API port
EXPOSE 3003

CMD ["server"]
