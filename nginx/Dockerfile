# ============================================================
# Nginx Dockerfile — Reverse Proxy & Security Ingress
# ============================================================
FROM nginx:1.25-alpine

# Copy hardened Nginx configuration
COPY default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
