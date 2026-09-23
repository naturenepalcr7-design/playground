# ============================================================
# Nginx Dockerfile — Reverse Proxy & Security Ingress (HTTPS)
# ============================================================
FROM nginx:1.25-alpine

# Install OpenSSL for automated self-signed certificate generation
RUN apk add --no-cache openssl

# Copy hardened Nginx configuration
COPY default.conf /etc/nginx/conf.d/default.conf

# Copy entrypoint script to ensure SSL certificates exist
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Ensure SSL directories exist and pre-generate fallback SAN certificates
RUN mkdir -p /etc/nginx/ssl /etc/ssl/kmc && \
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout /etc/ssl/kmc/key.pem \
        -out /etc/ssl/kmc/cert.pem \
        -subj "/C=NP/ST=Bagmati/L=Kathmandu/O=Kathmandu Metropolitan City/OU=GIS Department/CN=103.69.126.226" \
        -addext "subjectAltName=IP:103.69.126.226,IP:127.0.0.1,DNS:localhost,DNS:kmc-gis-server" && \
    chmod 600 /etc/ssl/kmc/key.pem && \
    chmod 644 /etc/ssl/kmc/cert.pem

EXPOSE 80 443

ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]

