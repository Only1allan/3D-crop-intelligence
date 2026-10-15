#!/usr/bin/env bash
# Deploy AgriTwin to AWS Lightsail Container Service (single node, ephemeral disk).
# Prereqs: docker, aws CLI v2 with credentials, OPENROUTER_API_KEY (OpenRouter free tier).
# Usage: OPENROUTER_API_KEY=sk-or-... ./scripts/deploy-lightsail.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SERVICE_NAME="${LIGHTSAIL_SERVICE:-agritwin}"
POWER="${LIGHTSAIL_POWER:-micro}"
IMAGE="agritwin:latest"
LABEL="web"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || true)}}"
REGION="${REGION:-us-east-1}"

: "${OPENROUTER_API_KEY:?Set OPENROUTER_API_KEY first (a free key from https://openrouter.ai/keys)}"
command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
command -v aws >/dev/null || { echo "aws CLI v2 is required" >&2; exit 1; }

echo "==> Building image (linux/amd64, Lightsail runs x86_64)"
docker build --platform linux/amd64 -t "$IMAGE" .

echo "==> Ensuring container service '$SERVICE_NAME' ($POWER, 1 node) in $REGION"
if ! aws lightsail get-container-service --service-name "$SERVICE_NAME" --region "$REGION" \
     --query 'containerService.state' --output text >/dev/null 2>&1; then
  aws lightsail create-container-service --service-name "$SERVICE_NAME" \
    --power "$POWER" --scale 1 --region "$REGION" >/dev/null
fi
for _ in $(seq 1 60); do
  state=$(aws lightsail get-container-service --service-name "$SERVICE_NAME" --region "$REGION" \
          --query 'containerService.state' --output text 2>/dev/null || true)
  [ "$state" = "ACTIVE" ] && break
  sleep 10
done
[ "${state:-}" = "ACTIVE" ] || { echo "service is '$state', expected ACTIVE" >&2; exit 1; }

echo "==> Pushing image to Lightsail"
IMAGE_REF=$(aws lightsail push-container-image --service-name "$SERVICE_NAME" --label "$LABEL" \
  --image "$IMAGE" --region "$REGION" --query 'containerService.image' --output text)
echo "    pushed as $IMAGE_REF"

echo "==> Creating deployment"
DEPLOYMENT=$(mktemp /tmp/agritwin-deploy.XXXXXX.json)
trap 'rm -f "$DEPLOYMENT"' EXIT
cat > "$DEPLOYMENT" <<JSON
{
  "serviceName": "$SERVICE_NAME",
  "containers": {
    "web": {
      "image": "$IMAGE_REF",
      "ports": { "8000": "HTTP" },
      "environment": {
        "AGRITWIN_MODEL_PROVIDER": "openrouter",
        "OPENROUTER_API_KEY": "$OPENROUTER_API_KEY",
        "OPENROUTER_MODEL": "google/gemma-4-26b-a4b-it:free",
        "OPENROUTER_FALLBACK_MODEL": "nvidia/nemotron-3-super-120b-a12b:free",
        "AGRITWIN_TODAY": "2026-09-27",
        "AGRITWIN_LIVE_WEATHER": "1"
      }
    }
  },
  "publicEndpoint": {
    "containerName": "web",
    "containerPort": 8000,
    "healthCheck": {
      "healthyThreshold": 2,
      "unhealthyThreshold": 5,
      "timeoutSeconds": 10,
      "intervalSeconds": 10,
      "path": "/api/health",
      "successCodes": "200"
    }
  }
}
JSON
aws lightsail create-container-service-deployment --cli-input-json "file://$DEPLOYMENT" --region "$REGION" >/dev/null

echo "==> Waiting for deployment to become ACTIVE (first boot seeds the twin; a few minutes)"
for _ in $(seq 1 90); do
  dstate=$(aws lightsail get-container-service --service-name "$SERVICE_NAME" --region "$REGION" \
           --query 'containerService.currentDeployment.state' --output text 2>/dev/null || true)
  case "$dstate" in
    ACTIVE) break ;;
    FAILED) echo "deployment FAILED: $(aws lightsail get-container-service --service-name "$SERVICE_NAME" --region "$REGION" --query 'containerService.currentDeployment' --output json)" >&2; exit 1 ;;
  esac
  sleep 10
done
[ "${dstate:-}" = "ACTIVE" ] || { echo "deployment still '$dstate' after 15 min" >&2; exit 1; }

URL=$(aws lightsail get-container-service --service-name "$SERVICE_NAME" --region "$REGION" \
      --query 'containerService.url' --output text)
echo
echo "Deployed: $URL"
echo "Health:   $URL/api/health"
echo "Console:  $URL  (draft an advisory on plot B2, approve as an officer)"
