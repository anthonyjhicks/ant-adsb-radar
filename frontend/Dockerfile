# syntax=docker/dockerfile:1
FROM node:22-slim AS build
WORKDIR /app

ARG PUBLIC_API_URL
ENV PUBLIC_API_URL=${PUBLIC_API_URL}

ARG PUBLIC_VERSION=dev
ENV PUBLIC_VERSION=${PUBLIC_VERSION}

ARG PUBLIC_VERSION_URL=
ENV PUBLIC_VERSION_URL=${PUBLIC_VERSION_URL}

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY . .
RUN npx svelte-kit sync && npm run build

FROM node:22-slim
WORKDIR /app

COPY --from=build /app/build build/
COPY --from=build /app/package.json .
COPY --from=build /app/node_modules node_modules/

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "build"]
