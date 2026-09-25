# Build the bundle, then serve it from nginx. The build stage's node_modules
# never reach the image.
FROM node:24-alpine AS build
WORKDIR /app

# Corepack is installed explicitly: Node 25+ no longer bundles it, and doing
# it now makes the Node 26 move a version bump only. The pnpm version comes
# from package.json's packageManager field (corepack install, below) — the
# one place it is written. It must be pnpm 12: pnpm-workspace.yaml uses
# allowBuilds and minimumReleaseAgeExclude, which older pnpm ignores in
# silence, and allowBuilds is what lets msw's postinstall run at all.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm i -g corepack@0.36.0 && corepack enable
# `husky` is package.json's `prepare` script. There is no .git in the build
# context (see .dockerignore), and husky exits cleanly without one — this just
# says so out loud.
ENV HUSKY=0

# pnpm-workspace.yaml is copied WITH the manifest and the lockfile: it carries
# the install settings above, so leaving it out of this layer changes what
# `pnpm install` does.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack install
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
# nginx.conf is a template. The image's entrypoint renders it into
# conf.d/default.conf at start; the stock file of that name goes first, so the
# rendered template is the only server config in conf.d.
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/templates/default.conf.template
# Where nginx proxies /api, read at container start: scheme://host:port, no
# path (see nginx.conf's /api/ location). The default is the compose service.
ENV API_UPSTREAM=http://api:4040
# envsubst substitutes only env names matching this, so nginx's own $host,
# $scheme and the rest survive the render.
ENV NGINX_ENVSUBST_FILTER='^API_UPSTREAM$'
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
