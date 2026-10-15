# syntax=docker/dockerfile:1
# One image, one process: FastAPI serves the built console, /api and /mcp (see agritwin/api/app.py).
# Stage 1 builds the Vite console; stage 2 installs the app editable so ROOT (/app) resolves
# web/dist, data/ and fixtures/ the same way it does in local development.

FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    AGRITWIN_HOST=0.0.0.0 \
    AGRITWIN_PORT=8000 \
    AGRITWIN_MCP_URL=http://127.0.0.1:8000/mcp/
WORKDIR /app
COPY pyproject.toml README.md LICENSE ./
COPY agritwin ./agritwin
COPY evals ./evals
COPY fixtures ./fixtures
COPY scripts ./scripts
RUN pip install --no-cache-dir --retries 10 --timeout 120 -e . \
 && useradd --create-home app \
 && chown -R app:app /app
COPY --from=web /web/dist ./web/dist
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=8).status==200 else 1)"
CMD ["python", "-m", "agritwin.api.app"]
