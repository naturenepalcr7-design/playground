# ==============================================================================
# Generate Self-Signed SSL Certificate with SAN for 103.69.126.226 (PowerShell)
# ==============================================================================
$ErrorActionPreference = "Stop"

$sslDir = Join-Path $PSScriptRoot "ssl"
if (-not (Test-Path $sslDir)) {
    New-Item -ItemType Directory -Path $sslDir -Force | Out-Null
}

$certFile = Join-Path $sslDir "cert.pem"
$keyFile  = Join-Path $sslDir "key.pem"
$cnfFile  = Join-Path $sslDir "openssl.cnf"

# Locate OpenSSL executable
$opensslExe = "openssl"
if (-not (Get-Command $opensslExe -ErrorAction SilentlyContinue)) {
    $gitOpenssl = "C:\Program Files\Git\usr\bin\openssl.exe"
    if (Test-Path $gitOpenssl) {
        $opensslExe = $gitOpenssl
    } else {
        Write-Error "OpenSSL was not found in PATH or Git installation."
        exit 1
    }
}

$cnfContent = @"
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
"@

Set-Content -Path $cnfFile -Value $cnfContent -Encoding utf8

Write-Host "==> Generating 2048-bit RSA Private Key and SAN Certificate..." -ForegroundColor Cyan
& $opensslExe req -x509 -nodes -days 3650 -newkey rsa:2048 `
    -keyout $keyFile `
    -out $certFile `
    -config $cnfFile

Remove-Item -Path $cnfFile -Force -ErrorAction SilentlyContinue

Write-Host "==> Certificate generated successfully at:" -ForegroundColor Green
Write-Host "    Certificate: $certFile"
Write-Host "    Private Key: $keyFile"
