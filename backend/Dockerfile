FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY src ./src
RUN pip install --upgrade pip && pip install .

# storage montado em /srv/oghma via volume
ENV OGHMA_STORAGE_ROOT=/srv/oghma
EXPOSE 8000
CMD ["uvicorn", "oghma.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
