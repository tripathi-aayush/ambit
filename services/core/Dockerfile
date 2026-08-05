FROM docker:27-cli AS docker-cli

FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# The `docker` CLI binary (no daemon) -- core needs it to `docker exec` into
# the sandbox container (see app/executor.py), talking to the host's daemon
# via the socket bind-mounted in docker-compose.yml. Debian's docker.io
# package doesn't reliably ship the client binary (varies by release, and
# pulls in a full unneeded second daemon besides) -- copying the official
# static binary is the standard, portable way to do this.
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY migrations ./migrations
COPY alembic.ini .

CMD alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000
