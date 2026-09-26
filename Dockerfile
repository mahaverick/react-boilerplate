# Build the bundle, then serve it from nginx. The build stage's node_modules
# never reach the image.
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
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
# notification stream's `fetch` URL and the Google OAuth anchor all hardcode it
# too. The `--build-arg VITE_API_URL=/api/v2` this file used to accept moved the
# axios base and nothing else, so it shipped an image whose notification stream
# and Google sign-in were broken with nothing in any log to say so.
RUN pnpm build

# The unprivileged nginx image runs as uid 101 and listens on 8080. Both base
# images are pinned by digest, and Renovate moves each tag and digest together.
FROM nginxinc/nginx-unprivileged:1.30.5-alpine@sha256:4714e0b1b2577eaa1a6131d07c958b67f0eb68e6d0521e90c6e5287db8cf0bc5
COPY --from=build /app/dist /usr/share/nginx/html
# Everything nginx writes at start or while serving goes under /tmp, so the
# root filesystem can be mounted read-only. /tmp must be writable (a tmpfs).
COPY docker/nginx.main.conf /etc/nginx/nginx.conf
# nginx.conf is a template. The image's entrypoint renders it into
# $NGINX_ENVSUBST_OUTPUT_DIR at start. The stock server config is not included
# any more, and is removed so the entrypoint's IPv6 script has nothing to edit.
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/templates/default.conf.template
ENV NGINX_ENVSUBST_OUTPUT_DIR=/tmp/nginx/conf.d
# Runs before the stock envsubst script. --chmod because the file is owned by
# root and the image's user cannot chmod it afterwards.
COPY --chmod=0755 docker/05-prepare.sh /docker-entrypoint.d/05-prepare.sh
# Where nginx proxies /api, read at container start: scheme://host:port, no
# path (see nginx.conf's /api/ location). The default assumes a compose
# service named `api`.
ENV API_UPSTREAM=http://api:4040
# envsubst substitutes only env names matching this, so nginx's own $host,
# $scheme and the rest survive the render.
ENV NGINX_ENVSUBST_FILTER='^API_UPSTREAM$'
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
