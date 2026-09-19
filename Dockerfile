FROM python:3.11-slim
WORKDIR /app

LABEL "author"="swing music"
EXPOSE 1970/tcp
VOLUME /music
VOLUME /config

RUN apt-get update 

RUN apt-get install -y gcc libev-dev 
RUN apt-get install -y ffmpeg libavcodec-extra 
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy repo root files needed for installation
COPY pyproject.toml requirements.txt version.txt ./ 
COPY src/ ./src/

# Install the package and its dependencies
RUN pip install --no-cache-dir .

# ⚠️ The default config parent, so a bare `aivinnet --password-reset` (as the
# startup banner suggests) reaches the SAME data as the server. Without it the
# tool falls back to /root/.config, sets up an empty second instance there and
# reports success — for a password the real server never sees.
ENV XDG_CONFIG_HOME=/config
# Drops the container's bridge address (172.x) from the startup banner.
ENV AIVINNET_IN_CONTAINER=1

ENTRYPOINT ["python", "-m", "aivinnet", "--host", "0.0.0.0", "--config", "/config"]
