#!/usr/bin/env bash
# Creates the long-lived self-signed code-signing certificate that release builds are signed with
# (.github/workflows/build-macos-on-tag.yml). Run once, on your Mac:
#
#   apps/macos/scripts/make-signing-cert.sh [output-dir]     # default: ~/Projects/just-notch-signing
#
# A stable certificate makes the app's designated requirement
#   identifier "com.justanarthur.justnotch" and certificate leaf = H"<sha1>"
# the same for every build, so privacy permissions (TCC) and Keychain access survive updates.
# Losing it means users grant everything again once, so back it up.
#
# Writes cert.p12 (key + certificate), password.txt (the p12's password), cert.pem and sha1.txt.
# Touches no keychain.
set -euo pipefail

CN="Just Notch Self-Signed"
out="${1:-$HOME/Projects/just-notch-signing}"

# macOS's /usr/bin/openssl is LibreSSL, whose PKCS#12 defaults (3DES, SHA-1 MAC) `security import`
# reads. OpenSSL 3 defaults to AES/PBKDF2, which older macOS versions reject, so ask it for the legacy ones.
openssl=/usr/bin/openssl
[ -x "$openssl" ] || openssl="$(command -v openssl)"
legacy=()
"$openssl" version | grep -q '^OpenSSL 3' && legacy=(-legacy)

if [ -e "$out/cert.p12" ]; then
  echo "error: $out/cert.p12 already exists; a new certificate would change the app's identity again" >&2
  exit 1
fi
mkdir -p "$out"
chmod 700 "$out"
umask 077

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cat > "$work/req.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $CN
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
EOF

"$openssl" req -x509 -newkey rsa:2048 -nodes -sha256 -days 7300 \
  -config "$work/req.cnf" -keyout "$work/key.pem" -out "$out/cert.pem" 2> /dev/null

password="$("$openssl" rand -hex 24)"
printf '%s' "$password" > "$out/password.txt"
"$openssl" pkcs12 -export ${legacy[@]+"${legacy[@]}"} -inkey "$work/key.pem" -in "$out/cert.pem" \
  -name "$CN" -out "$out/cert.p12" -passout file:"$out/password.txt"

sha1="$("$openssl" x509 -in "$out/cert.pem" -noout -fingerprint -sha1 | sed 's/.*=//; s/://g')"
echo "$sha1" > "$out/sha1.txt"

cat <<EOF

Created "$CN" in $out
  cert.p12      key + certificate (the secret)
  password.txt  the p12's password
  cert.pem      the certificate alone (public)
  sha1.txt      $sha1

Valid until: $("$openssl" x509 -in "$out/cert.pem" -noout -enddate | sed 's/notAfter=//')
Release builds will carry the designated requirement:
  identifier "com.justanarthur.justnotch" and certificate leaf = H"$(echo "$sha1" | tr 'A-F' 'a-f')"

Next, run these yourself (any shell, zsh included):

  base64 -i "$out/cert.p12" | gh secret set MACOS_CERT_P12 -R justAnArthur/just-notch
  gh secret set MACOS_CERT_PASSWORD -R justAnArthur/just-notch < "$out/password.txt"

Then back up cert.p12 and the password somewhere safe (a password manager entry with the p12
attached), and delete the folder:

  rm -rf "$out"

Keep the certificate: a new one changes the app's identity, and every user grants permissions again.
EOF
