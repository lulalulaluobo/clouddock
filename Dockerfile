# syntax=docker/dockerfile:1
FROM jiangrui1994/cloudsaver@sha256:e2a7395420772ac3e5d9fd9d448ba135efca03ba864b5ad95f6f9b7df516c66c
ARG CLOUDDOCK_VERSION=1.2.0
LABEL org.opencontainers.image.title="CloudDock" \
      org.opencontainers.image.description="CloudDock: Quark and Baidu share transfers, fnOS downloads and built-in AriaNg" \
      org.opencontainers.image.url="https://hub.docker.com/r/lulalulaluobo/clouddock" \
      org.opencontainers.image.source="" \
      org.opencontainers.image.revision="" \
      org.opencontainers.image.base.name="jiangrui1994/cloudsaver@sha256:e2a7395420772ac3e5d9fd9d448ba135efca03ba864b5ad95f6f9b7df516c66c" \
      org.opencontainers.image.version="${CLOUDDOCK_VERSION}"
ENV NODE_ENV=production PORT=8009 CLOUDDOCK_VERSION=${CLOUDDOCK_VERSION}
WORKDIR /app
COPY native/ /app/clouddock/
COPY build/web/ /usr/share/nginx/html/
COPY README.md /app/clouddock/README.md
RUN chmod 755 /app/clouddock/entrypoint.sh \
    && mkdir -p /app/logs /downloads \
    && node --check /app/clouddock/boot.cjs \
    && node --check /app/clouddock/init-runtime.cjs
EXPOSE 8008
HEALTHCHECK --interval=20s --timeout=8s --start-period=30s --retries=3 \
  CMD node /app/clouddock/healthcheck.cjs
ENTRYPOINT ["/bin/sh", "/app/clouddock/entrypoint.sh"]
