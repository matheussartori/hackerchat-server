# syntax=docker/dockerfile:1

# Multi-stage build with two useful end targets:
#
#   --target dev   development image: full toolchain, `tsx watch`, source mounted
#   --target prod  production image (default): dist + runtime deps only, non-root
#
ARG NODE_VERSION=24-alpine


# ---------------------------------------------------------------------------
# base — shared foundation
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS base

WORKDIR /app

# `tini` reaps zombies and forwards signals, so the app receives the SIGTERM it
# listens for instead of being killed outright.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    PORT=9898 \
    LOG_LEVEL=info


# ---------------------------------------------------------------------------
# deps — every dependency, including the build toolchain
# ---------------------------------------------------------------------------
FROM base AS deps

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev


# ---------------------------------------------------------------------------
# build — compile TypeScript to dist/
# ---------------------------------------------------------------------------
FROM deps AS build

COPY tsconfig.json ./
COPY src ./src
RUN npm run build


# ---------------------------------------------------------------------------
# prod-deps — runtime dependencies only
# ---------------------------------------------------------------------------
FROM base AS prod-deps

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev


# ---------------------------------------------------------------------------
# dev — local development, source bind-mounted over /app/src
# ---------------------------------------------------------------------------
FROM deps AS dev

ENV NODE_ENV=development \
    LOG_LEVEL=debug

COPY tsconfig.json ./
COPY src ./src

EXPOSE 9898

# `--host 0.0.0.0` is not needed: the server binds every interface by default.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "dev"]


# ---------------------------------------------------------------------------
# prod — the shipped image
# ---------------------------------------------------------------------------
FROM base AS prod

# `node` (uid 1000) ships with the official image; running as it keeps the
# container off root.
COPY --chown=node:node package.json ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node

EXPOSE 9898

# The server answers /healthz with 200 as soon as it is accepting connections.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||9898)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
