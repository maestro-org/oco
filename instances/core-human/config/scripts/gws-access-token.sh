#!/usr/bin/env bash
set -euo pipefail

DEFAULT_KEY_FILE="/var/lib/openclaw/state/secrets/gws-service-account.json"
LEGACY_DEFAULT_KEY_FILE="/var/lib/openclaw/state/secrets/davis-gws-service-account.json"
KEY_FILE="${GWS_SERVICE_ACCOUNT_KEY_FILE:-${DAVIS_GWS_SERVICE_ACCOUNT_KEY_FILE:-}}"
SUBJECT="${GWS_IMPERSONATED_EMAIL:-${DAVIS_GWS_IMPERSONATED_EMAIL:-}}"
SCOPE="${GWS_SCOPE:-${DAVIS_GWS_SCOPE:-https://www.googleapis.com/auth/calendar.events}}"

if [[ -z "${KEY_FILE}" ]]; then
  if [[ -f "${DEFAULT_KEY_FILE}" ]]; then
    KEY_FILE="${DEFAULT_KEY_FILE}"
  else
    KEY_FILE="${LEGACY_DEFAULT_KEY_FILE}"
  fi
fi

if [[ ! -f "${KEY_FILE}" ]]; then
  echo "Error: Service-account key file not found: ${KEY_FILE}" >&2
  exit 1
fi

if [[ -z "${SUBJECT}" ]]; then
  echo "Error: GWS_IMPERSONATED_EMAIL is required (or legacy DAVIS_GWS_IMPERSONATED_EMAIL)." >&2
  exit 1
fi

CLIENT_EMAIL="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["client_email"])' "${KEY_FILE}")"
TOKEN_URI="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("token_uri","https://oauth2.googleapis.com/token"))' "${KEY_FILE}")"

tmp_key="$(mktemp)"
trap 'rm -f "${tmp_key}"' EXIT
python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["private_key"])' "${KEY_FILE}" > "${tmp_key}"

b64url() {
  openssl base64 -A | tr '+/' '-_' | tr -d '='
}

now="$(date +%s)"
exp="$((now + 3600))"

header='{"alg":"RS256","typ":"JWT"}'
export CLIENT_EMAIL SUBJECT SCOPE TOKEN_URI now exp
payload="$(python3 - <<'PY'
import json
import os

print(
    json.dumps(
        {
            "iss": os.environ["CLIENT_EMAIL"],
            "scope": os.environ["SCOPE"],
            "aud": os.environ["TOKEN_URI"],
            "exp": int(os.environ["exp"]),
            "iat": int(os.environ["now"]),
            "sub": os.environ["SUBJECT"],
        },
        separators=(",", ":"),
    )
)
PY
)"

unsigned_token="$(printf '%s' "${header}" | b64url).$(printf '%s' "${payload}" | b64url)"
signature="$(printf '%s' "${unsigned_token}" | openssl dgst -sha256 -sign "${tmp_key}" | b64url)"
jwt_assertion="${unsigned_token}.${signature}"

response="$(
  curl -sS -X POST "${TOKEN_URI}" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer" \
    --data-urlencode "assertion=${jwt_assertion}"
)"

access_token="$(python3 -c 'import json,sys;print(json.load(sys.stdin).get("access_token",""))' <<< "${response}")"
if [[ -z "${access_token}" ]]; then
  echo "Error: Failed to obtain access token. Response: ${response}" >&2
  exit 1
fi

printf '%s\n' "${access_token}"
