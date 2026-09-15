# syntax=docker/dockerfile:1
FROM python:3.12-slim

WORKDIR /app

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends curl

COPY pyproject.toml .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install .

COPY app/ app/

EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
