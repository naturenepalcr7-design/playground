#!/bin/sh
# ==============================================================================
# Generate Self-Signed SSL Certificate with SAN for 103.69.126.226 (Bash / POSIX)
# ==============================================================================
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
SSL_DIR="${DIR}/ssl"
mkdir -p "${SSL_DIR}"

CERT_FILE="${SSL_DIR}/cert.pem"
KEY_FILE="${SSL_DIR}/key.pem"
CNF_FILE="${SSL_DIR}/openssl.cnf"

cat <<EOF > "${CNF_FILE}"
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

echo "==> Generating 2048-bit RSA Private Key and SAN Certificate..."
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout "${KEY_FILE}" \
    -out "${CERT_FILE}" \
    -config "${CNF_FILE}"

chmod 600 "${KEY_FILE}"
chmod 644 "${CERT_FILE}"
rm -f "${CNF_FILE}"

echo "==> Certificate generated successfully at:"
echo "    Certificate: ${CERT_FILE}"
echo "    Private Key: ${KEY_FILE}"
