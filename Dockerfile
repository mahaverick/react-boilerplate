# Build the bundle, then serve it from nginx. The build stage's node_modules
# never reach the image.
FROM node:24-alpine AS build
WORKDIR /app

# PINNED, not "whatever pnpm this Node image bundles". pnpm-workspace.yaml uses
# `allowBuilds` and `minimumReleaseAgeExclude`, which an older pnpm ignores in
# silence — and `allowBuilds` is what lets msw's postinstall run at all.
#
# Pinned HERE rather than through package.json's `packageManager` field: adding
# that field makes pnpm 12 record itself in the lockfile
# (`packageManagerDependencies`, ~160 lines of per-platform binaries), and
# `--frozen-lockfile` then fails until the lockfile is regenerated. Keep this
# version in step with .github/workflows/ci.yml, which pins the same one.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@12.4.1 --activate
# `husky` is package.json's `prepare` script. There is no .git in the build
# context (see .dockerignore), and husky exits cleanly without one — this just
# says so out loud.
ENV HUSKY=0

# pnpm-workspace.yaml is copied WITH the manifest and the lockfile: it carries
# the install settings above, so leaving it out of this layer changes what
# `pnpm install` does.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# No build ARGs, deliberately. The API prefix is FIXED at /api/v1 — it lives in
# src/constants/routes.ts as API_PREFIX, and nginx.conf's SSE location, the
# EventSource URL and the Google OAuth anchor all hardcode it too. The
# `--build-arg VITE_API_URL=/api/v2` this file used to accept moved the axios
# base and nothing else, so it shipped an image whose notification stream and
# Google sign-in were broken with nothing in any log to say so.
RUN pnpm build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
