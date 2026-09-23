# KMC-GIS-SERVER

WebGIS & Field Mapping Tasking Manager with geofenced data collection for Kathmandu Metropolitan City (काठमाडौँ महानगरपालिका).

## Quick Start

```bash
docker compose up --build -d
```

### Exposed Ports & Ingress
- **Port 443 (HTTPS)**: Primary secure ingress for WebGIS portal, REST API, OGC services, and TileServer. Required by modern web browsers for GPS geolocation (`navigator.geolocation`).
- **Port 80 (HTTP)**: Automatically redirects incoming browser traffic (301) to HTTPS, while serving `/health` directly for internal healthchecks.

### SSL / TLS Certificates
SSL certificates are located in `nginx/ssl/`:
- `nginx/ssl/cert.pem`
- `nginx/ssl/key.pem`

A pre-generated 10-year self-signed certificate with Subject Alternative Names (SAN) for `103.69.126.226`, `127.0.0.1`, and `localhost` is included. If custom certificates or a domain name CA certificate is used, simply place them into `nginx/ssl/` or mount them into `/etc/nginx/ssl`.

To regenerate the self-signed certificate at any time:
- **Windows (PowerShell)**: `.\nginx\generate-ssl.ps1`
- **Linux (Bash)**: `./nginx/generate-ssl.sh`

### GPS Geolocation in Browser
When accessing `https://103.69.126.226/dashboard` for the first time:
1. Accept the SSL certificate notice by clicking **Advanced** &rarr; **Proceed to 103.69.126.226**.
2. Click **Allow** when prompted for Location (GPS) access.
3. Because the connection is served over HTTPS, the browser considers the site a **Secure Context**, allowing real-time GPS tracking and geofenced surveying.
