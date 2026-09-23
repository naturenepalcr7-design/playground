# KMC-GIS-SERVER

WebGIS & Field Mapping Tasking Manager with geofenced data collection.

## Quick Start

No `.env` file is required. Simply run:

```bash
docker compose up --build
```
*(or `docker compose up -d --build` to run in detached background mode)*

All database, Redis, authentication, and service defaults are built right in. The application is served on port **`8090`** by default.

## Architecture & Ports

This application runs inside an isolated Docker bridge network (`kmc_net`). **Only one port is exposed to the host server:**

| Service | Internal Port (Isolated) | Exposed to Host | Purpose |
|---------|--------------------------|-----------------|---------|
| **nginx** | 80 | **`${HOST_PORT:-8090}`** | Reverse proxy (Only exposed port) |
| backend | 8000 | *None* (internal only) | REST API & PostGIS engine |
| frontend | 3000 | *None* (internal only) | Next.js web application |
| tileserver | 8080 | *None* (internal only) | Vector & raster tile server |
| postgres | 5432 | *None* (internal only) | PostGIS spatial database |
| redis | 6379 | *None* (internal only) | Session cache & task locks |

> [!NOTE]
> Ports **80, 443, 3000, 8000, and 8080 are NOT used on the host**, preventing conflicts with existing server services.
> By default, the entire application is accessible at **`http://<server-ip>:8090`**. You can change `HOST_PORT` in `.env` to any unused port.

---

## Production Server Deployment & Security

### 1. Protecting `.env` on the Server
- **Version Control**: `.env` is listed in `.gitignore` and is never committed to Git.
- **Docker Images**: `.dockerignore` files prevent `.env` from being baked into Docker image layers.
- **Web Access**: Nginx blocks any web request targeting `.env` or hidden files with HTTP 404.
- **File System Permissions**: On your production server, restrict access so only the authorized user can read `.env`:
  ```bash
  chmod 600 .env
  ```
- **Alternative (No `.env` file)**: You can also inject environment variables directly into the server shell environment, systemd service, or CI/CD pipeline (e.g. GitHub Secrets / GitLab CI) without keeping a physical `.env` file on disk.

### 2. Reverse Proxy & SSL Setup (Host Nginx / Traefik / Caddy)
If your host already has Nginx, Caddy, or Traefik running on ports 80/443 with SSL certificates, forward your domain to port 8090:

**Example Host Nginx configuration:**
```nginx
server {
    listen 80;
    listen 443 ssl http2;
    server_name gis.yourdomain.com;

    # SSL certificates managed on the host
    ssl_certificate /etc/letsencrypt/live/gis.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/gis.yourdomain.com/privkey.pem;

    client_max_body_size 0;

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

