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

# The version, e.g. `v2026.8.5` (a leading `v` is fine) — set by the release
# workflow. It is NOT decoration: it picks the release this container downloads
# its web client from, and decides when that client counts as stale.
#
# ⚠️ Why a build-arg: the build context has no `.git`, so setuptools-scm cannot
# read the tag and would write its fallback 0.0.0 into the metadata. The arg
# goes straight into that metadata, which is the app's ONLY version source (#192).
#
# A plain `docker build .` without it is an unversioned build and says 0.0.0:
# it fetches the latest stable client. To build a specific release locally:
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
