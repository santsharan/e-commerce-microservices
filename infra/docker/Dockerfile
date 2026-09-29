# syntax=docker/dockerfile:1

# One image build compiles the workspace. The runtime stage selects the service
# so Compose can reuse the compile layer for every service.
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install -g corepack@latest \
  && corepack enable \
  && corepack prepare pnpm@12.6.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile
RUN pnpm exec tsc -b --pretty false

FROM node:24-bookworm-slim AS runtime
ARG SERVICE
ENV NODE_ENV=production
ENV SERVICE=${SERVICE}
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
CMD ["sh", "-c", "exec node apps/$SERVICE/dist/main.js"]
