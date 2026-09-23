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

# Ensure SSL directory exists
RUN mkdir -p /etc/nginx/ssl

EXPOSE 80 443

ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]

