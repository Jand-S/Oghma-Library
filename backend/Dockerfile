FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux \
    && mkdir -p /opt/curl-impersonate \
    && curl -fsSL \
       "https://github.com/lwthiker/curl-impersonate/releases/download/v0.6.1/curl-impersonate-v0.6.1.x86_64-linux-gnu.tar.gz" \
       | tar -xz -C /opt/curl-impersonate \
    && chmod +x /opt/curl-impersonate/curl-impersonate-ff /opt/curl-impersonate/curl_ff* \
    && cp /opt/curl-impersonate/curl_ff117 /opt/curl-impersonate/curl_ff
ENV PATH="/opt/curl-impersonate:${PATH}"

COPY pyproject.toml ./
COPY src ./src
RUN pip install --upgrade pip && pip install .

# storage montado em /srv/oghma via volume
ENV OGHMA_STORAGE_ROOT=/srv/oghma
EXPOSE 8000
CMD ["uvicorn", "oghma.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
