FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    AUDIVERIS_COMMAND=/opt/audiveris/bin/Audiveris

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ca-certificates \
    curl \
    fontconfig \
    libfreetype6 \
    libglib2.0-0 \
    libx11-6 \
    libxext6 \
    libxi6 \
    libxrender1 \
    libxt6 \
    libxtst6 \
    procps \
    unzip \
    && rm -rf /var/lib/apt/lists/*

RUN curl -L -o /tmp/audiveris.deb \
    https://github.com/Audiveris/audiveris/releases/download/5.8.1/Audiveris-5.8.1-ubuntu24.04-x86_64.deb \
    && apt-get update \
    && apt-get install -y /tmp/audiveris.deb \
    && rm -f /tmp/audiveris.deb \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN python3 -m pip install --break-system-packages -r /app/requirements.txt

COPY . /app

EXPOSE 10000

CMD ["sh", "-c", "python3 -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
