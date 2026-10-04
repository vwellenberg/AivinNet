# ---------------------------------------------------------------------------
# Stage 1: the web client, built from THIS checkout.
#
# ⚠️ Without it the image carried no client at all and downloaded one from the
# GitHub releases on first start — for any build that is not a published
# release (master, a PR, a local `docker build .`) that is the latest STABLE
# release's client, so a master server ran against an older UI and every API
# change on master broke such images silently. Bundled, server and client
# always come from the same commit.
#
# `--platform=$BUILDPLATFORM`: the output is static files, identical for every
# target, so the multi-arch release build runs this stage once and natively
# instead of under QEMU emulation. The full `node` image (not `-slim`) on
# purpose: `sharp`'s install falls back to node-gyp when its prebuilt binary
# cannot be fetched, and that needs python/make/g++ — the same toolchain the
# GitHub runners that build the release client have.
# ---------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:20 AS client
WORKDIR /client
# Manifests first, so a source-only change keeps the dependency layer cached.
COPY client/package.json client/yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 600000
COPY client/ ./
RUN yarn build --outDir /dist/client

# Zipped exactly like the release workflow does it (`zip -r client.zip client`):
# ONE top-level `client/` directory. `extract_default_client` unpacks the zip
# into the config directory and the server serves `<config>/client`, so a zip
# of the folder's CONTENTS would scatter index.html into the config root.
# `python -m zipfile -c` names top-level entries by their basename -> `client/…`.
FROM --platform=$BUILDPLATFORM python:3.11-slim AS client-zip
COPY --from=client /dist/client /dist/client
RUN cd /dist && python -m zipfile -c /client.zip client

# ---------------------------------------------------------------------------
# Stage 2: the server.
# ---------------------------------------------------------------------------
FROM python:3.11-slim
WORKDIR /app

LABEL org.opencontainers.image.title="AivinNet" \
      org.opencontainers.image.source="https://github.com/vwellenberg/AivinNet"
EXPOSE 1970/tcp
VOLUME /music
VOLUME /config

RUN apt-get update 

RUN apt-get install -y gcc libev-dev 
RUN apt-get install -y ffmpeg libavcodec-extra 
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy repo root files needed for installation
COPY pyproject.toml requirements.txt ./
COPY src/ ./src/
# Must land BEFORE `pip install .`, and must be listed in
# `[tool.setuptools.package-data]` — the build has no `.git`, so setuptools-scm
# would not pick up an untracked file on its own.
COPY --from=client-zip /client.zip ./src/aivinnet/client.zip

# The version, e.g. `v2026.8.5` (a leading `v` is fine) — set by the release
# workflow. It is NOT decoration: it is what `--version` and the startup banner
# report, and the client stamp records it (see `AssetHandler.client_is_stale`).
#
# ⚠️ Why a build-arg: the build context has no `.git`, so setuptools-scm cannot
# read the tag and would write its fallback 0.0.0 into the metadata. The arg
# goes straight into that metadata, which is the app's ONLY version source (#192).
#
# A plain `docker build .` without it is an unversioned build and says 0.0.0 —
# which no longer matters for the client: that is bundled from the same checkout
# (stage 1), and refreshed by the bundle's fingerprint, not by this version.
# To build a specific release locally:
#     docker build --build-arg app_version=$(git describe --tags --abbrev=0) .
# Declared right before its only user, so the apt layers above stay cached.
ARG app_version=
RUN if [ -n "$app_version" ]; then \
        export SETUPTOOLS_SCM_PRETEND_VERSION_FOR_AIVINNET="${app_version#v}"; \
    fi \
    && pip install --no-cache-dir .

# ⚠️ The default config parent, so a bare `aivinnet --password-reset` (as the
# startup banner suggests) reaches the SAME data as the server. Without it the
# tool falls back to /root/.config, sets up an empty second instance there and
# reports success — for a password the real server never sees.
ENV XDG_CONFIG_HOME=/config
# Drops the container's bridge address (172.x) from the startup banner.
ENV AIVINNET_IN_CONTAINER=1

ENTRYPOINT ["python", "-m", "aivinnet", "--host", "0.0.0.0", "--config", "/config"]
