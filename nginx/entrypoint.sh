#!/bin/sh
set -e

SSL_DIR="/etc/nginx/ssl"
CERT_FILE="${SSL_DIR}/cert.pem"
KEY_FILE="${SSL_DIR}/key.pem"

# Check if certificates exist
if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
    echo "==> [SSL Init] Certificates not found in ${SSL_DIR}. Generating self-signed SAN certificate..."
    mkdir -p "${SSL_DIR}"

    cat <<EOF > /tmp/openssl.cnf
[req]
default_bits       = 2048
prompt             = no
default_md         = sha256
distinguished_name = dn
x509_extensions    = v3_req

[dn]
C  = NP
ST = Bagmati
L  = Kathmandu
O  = Kathmandu Metropolitan City
OU = GIS Department
CN = 103.69.126.226

[v3_req]
subjectKeyIdentifier   = hash
authorityKeyIdentifier = keyid:always,issuer
basicConstraints       = CA:TRUE
keyUsage               = digitalSignature, keyEncipherment, keyCertSign
subjectAltName         = @alt_names

[alt_names]
IP.1  = 103.69.126.226
IP.2  = 127.0.0.1
DNS.1 = localhost
DNS.2 = kmc-gis-server
EOF

    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout "$KEY_FILE" \
        -out "$CERT_FILE" \
        -config /tmp/openssl.cnf

    chmod 600 "$KEY_FILE"
    chmod 644 "$CERT_FILE"
    rm -f /tmp/openssl.cnf
    echo "==> [SSL Init] Self-signed SAN certificate generated successfully."
else
    echo "==> [SSL Init] SSL certificates found in ${SSL_DIR}. Ready to serve HTTPS."
fi

exec "$@"
