#!/bin/sh
set -e

MOUNT_DIR="/etc/nginx/ssl"
TARGET_DIR="/etc/ssl/kmc"
mkdir -p "${TARGET_DIR}"

TARGET_CERT="${TARGET_DIR}/cert.pem"
TARGET_KEY="${TARGET_DIR}/key.pem"

MOUNT_CERT="${MOUNT_DIR}/cert.pem"
MOUNT_KEY="${MOUNT_DIR}/key.pem"

# Check if valid certificates are mounted from the host
if [ -f "$MOUNT_CERT" ] && [ -f "$MOUNT_KEY" ] && [ -s "$MOUNT_CERT" ] && [ -s "$MOUNT_KEY" ]; then
    echo "==> [SSL Init] Found SSL certificates in ${MOUNT_DIR}. Using mounted certificates."
    cp -f "$MOUNT_CERT" "$TARGET_CERT"
    cp -f "$MOUNT_KEY" "$TARGET_KEY"
    chmod 600 "$TARGET_KEY"
    chmod 644 "$TARGET_CERT"
else
    echo "==> [SSL Init] Certificates not found in ${MOUNT_DIR}. Generating self-signed SAN certificate..."

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
        -keyout "$TARGET_KEY" \
        -out "$TARGET_CERT" \
        -config /tmp/openssl.cnf

    chmod 600 "$TARGET_KEY"
    chmod 644 "$TARGET_CERT"
    rm -f /tmp/openssl.cnf

    # If the mounted directory is writable, also copy to host directory for persistence
    if [ -d "$MOUNT_DIR" ] && touch "${MOUNT_DIR}/.write_test" 2>/dev/null; then
        rm -f "${MOUNT_DIR}/.write_test"
        cp -f "$TARGET_CERT" "$MOUNT_CERT" 2>/dev/null || true
        cp -f "$TARGET_KEY" "$MOUNT_KEY" 2>/dev/null || true
        echo "==> [SSL Init] Saved generated certificates to host directory ${MOUNT_DIR}."
    else
        echo "==> [SSL Init] Note: ${MOUNT_DIR} is read-only or not writable. Serving from internal SSL store."
    fi

    echo "==> [SSL Init] Self-signed SAN certificate active for 103.69.126.226 / localhost."
fi

exec "$@"
