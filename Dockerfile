# Build the bundle, then serve it from nginx. The build stage's node_modules
# never reach the image.
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /app

# Corepack is installed explicitly: Node 25+ does not bundle it, so the
# Node 26 move is a version bump only. The pnpm version comes
# from package.json's packageManager field (corepack install, below) — the
# one place it is written. It must be pnpm 12: pnpm-workspace.yaml uses
# allowBuilds and minimumReleaseAgeExclude, which older pnpm ignores in
# silence, and allowBuilds is what lets msw's postinstall run at all.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm i -g corepack@0.36.0 && corepack enable
# `husky` is package.json's `prepare` script. There is no .git in the build
# context (see .dockerignore); husky exits cleanly without one, and this makes
# that explicit.
ENV HUSKY=0

# pnpm-workspace.yaml is copied WITH the manifest and the lockfile: it carries
# the install settings above, so leaving it out of this layer changes what
# `pnpm install` does.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack install
RUN pnpm install --frozen-lockfile
# posthog-cli's postinstall is off (pnpm-workspace.yaml), so the npm wrapper
# downloads its binary from releases.posthog.com, with no checksum of its own.
# Run here, the download is cached with the dependencies and a failed one stops
# the build before anything else. The binary is hashed BEFORE it first runs,
# and later runs with the upload token mounted: a mismatch, or an architecture
# docker/posthog-cli.sha256 does not list, fails the build. A version bump of
# @posthog/cli must update that file.
ARG TARGETARCH
COPY docker/posthog-cli.sha256 /tmp/posthog-cli.sha256
RUN set -eu; \
    node node_modules/@posthog/cli/install.js; \
    bin=node_modules/@posthog/cli/node_modules/.bin_real/posthog-cli; \
    if [ ! -f "$bin" ] || [ -L "$bin" ]; then echo "$bin is not a regular file (the path the CLI runs)" >&2; exit 1; fi; \
    want=$(awk -v arch="$TARGETARCH" '$1 !~ /^#/ && $2 == arch { print $1 }' /tmp/posthog-cli.sha256); \
    if [ -z "$want" ]; then echo "no pinned posthog-cli hash for architecture '$TARGETARCH' (docker/posthog-cli.sha256)" >&2; exit 1; fi; \
    got=$(sha256sum "$bin" | cut -d' ' -f1); \
    if [ "$got" != "$want" ]; then echo "posthog-cli binary hash mismatch for $TARGETARCH: got $got, pinned $want" >&2; exit 1; fi; \
    echo "posthog-cli binary verified: $got"
RUN pnpm exec posthog-cli --version

COPY . .
# Inside a git checkout, posthog-cli's inject derives a release from git and
# calls PostHog. .dockerignore keeps .git out; this fails the build if it
# ever gets in.
RUN test ! -e .git || { echo '.git is in the build context (see .dockerignore)' >&2; exit 1; }

# No build ARG configures an environment. The API prefix is FIXED at /api/v1 —
# it lives in src/constants/routes.ts as API_PREFIX, and nginx.conf's SSE
# location, the notification stream's `fetch` URL and the Google OAuth anchor
# all derive from or hardcode it. A build arg that moved only the axios base
# would ship an image whose notification stream and Google sign-in are broken
# with nothing in any log to say so. The build ARGs are per commit, not per
# environment: GIT_SHA names the commit (vite.config.ts bakes it in as the
# release), and the two after the build say where its source maps are uploaded.
ARG GIT_SHA=dev
# vite.config.ts builds hidden source maps: no sourceMappingURL in any chunk.
RUN pnpm build
# Declared after the build, so a change to where the maps go re-runs only the
# upload, not `pnpm build`: an ARG is part of every later RUN's cache key.
ARG POSTHOG_SOURCEMAP_PROJECTS=
ARG POSTHOG_CLI_HOST=https://us.posthog.com
# Chunk ids go into every build, uploaded or not, so a file name never holds
# two different contents across builds. Inject must stay release-less: no
# --release-* flags and no .git, or it calls PostHog and writes a release id
# into every chunk. The token is a placeholder the CLI checks only for shape.
RUN POSTHOG_CLI_TOKEN=phx_inject_placeholder POSTHOG_CLI_ENV_ID=0 \
    pnpm exec posthog-cli sourcemap inject --directory dist
# The token is a BuildKit secret: never in a layer or in `docker history`.
RUN --mount=type=secret,id=posthog_cli_token,required=false \
    sh docker/upload-sourcemaps.sh
RUN find dist -name '*.map' -delete

# The unprivileged nginx image runs as uid 101 and listens on 8080. Both base
# images are pinned by digest, and Renovate moves each tag and digest together.
FROM nginxinc/nginx-unprivileged:1.30.5-alpine@sha256:4714e0b1b2577eaa1a6131d07c958b67f0eb68e6d0521e90c6e5287db8cf0bc5
COPY --from=build /app/dist /usr/share/nginx/html
# Everything nginx writes at start or while serving goes under /tmp, so the
# root filesystem can be mounted read-only. /tmp must be writable (a tmpfs).
COPY docker/nginx.main.conf /etc/nginx/nginx.conf
# nginx.conf is a template. The image's entrypoint renders it into
# $NGINX_ENVSUBST_OUTPUT_DIR at start. The stock server config is not
# included; it is removed so the entrypoint's IPv6 script has nothing to edit.
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/templates/default.conf.template
ENV NGINX_ENVSUBST_OUTPUT_DIR=/tmp/nginx/conf.d
# Runs before the stock envsubst script. --chmod because the file is owned by
# root and the image's user cannot chmod it afterwards.
COPY --chmod=0755 docker/05-prepare.sh /docker-entrypoint.d/05-prepare.sh
# Writes /tmp/runtime/runtime-config.js from POSTHOG_KEY and the other
# run-time settings at every start, and stops the container on an invalid one
# (see the script). The bundle is built once and holds none of them, so the
# same image is promoted through every environment.
COPY --chmod=0755 docker/10-runtime-config.sh /docker-entrypoint.d/10-runtime-config.sh
# Where nginx proxies /api, read at container start: scheme://host:port, no
# path (see nginx.conf's /api/ location). The default assumes a compose
# service named `api`.
ENV API_UPSTREAM=http://api:4040
# envsubst substitutes only env names matching this, so nginx's own $host,
# $scheme and the rest survive the render.
ENV NGINX_ENVSUBST_FILTER='^API_UPSTREAM$'
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
