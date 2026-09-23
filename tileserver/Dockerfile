# ============================================================
# TileServer-GL Dockerfile — Production Vector & Raster Serving
# Pre-seeded with default config and automated volume initialization
# ============================================================
FROM maptiler/tileserver-gl:latest

USER root

# Copy default config template and entrypoint initialization script
COPY config.json /default-config.json
COPY docker-entrypoint-init.sh /docker-entrypoint-init.sh
RUN sed -i 's/\r$//' /docker-entrypoint-init.sh \
	&& chmod +x /docker-entrypoint-init.sh

EXPOSE 8080

ENTRYPOINT ["/docker-entrypoint-init.sh"]
CMD ["-c", "/data/config.json", "--public_url", "/tiles"]
