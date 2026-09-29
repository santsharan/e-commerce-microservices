#!/bin/bash
# Local kind cluster for the manifests in infra/kubernetes/overlays/dev.
# Compose and this cluster share the Docker VM. Compose is stopped so the node can schedule.
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if [ -S "${HOME}/.colima/default/docker.sock" ] && [ -z "${DOCKER_HOST:-}" ]; then
  export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not reachable. Start Colima before make k8s-up." >&2
  exit 1
fi

if [ ! -f secrets/jwt-private.pem ] || [ ! -f secrets/jwt-public.pem ]; then
  echo "JWT files are missing. Run make jwt-keys first." >&2
  exit 1
fi

echo "Stopping Compose containers so the cluster can use the Docker VM. Volumes are kept."
docker compose --profile full stop

if ! kind get clusters | grep -qx commerce-flow; then
  kind create cluster --name commerce-flow --wait 180s
fi
kubectl config use-context kind-commerce-flow

images="
commerce-flow/api-gateway:local
commerce-flow/identity-service:local
commerce-flow/catalog-service:local
commerce-flow/inventory-service:local
commerce-flow/order-service:local
commerce-flow/payment-service:local
commerce-flow/notification-service:local
mongo:8.0
redis:8-alpine
apache/kafka:4.1.2
"
load_image() {
  local image="$1"
  if kind load docker-image "$image" --name commerce-flow; then
    return 0
  fi
  echo "Loading ${image} again as a single-platform image"
  docker build -t "${image}-kindflat" - <<EOF
FROM ${image}
LABEL kind.flat=true
EOF
  docker tag "${image}-kindflat" "${image}"
  kind load docker-image "${image}" --name commerce-flow
}

for image in $images; do
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "Image ${image} is not local. Run make apps-up once so the service images exist." >&2
    exit 1
  fi
  load_image "$image"
done

kubectl create namespace commerce-flow --dry-run=client -o yaml | kubectl apply -f -
kubectl -n commerce-flow create secret generic commerce-flow-jwt \
  --from-file=jwt-private.pem=secrets/jwt-private.pem \
  --from-file=jwt-public.pem=secrets/jwt-public.pem \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -k infra/kubernetes/overlays/dev

kubectl -n commerce-flow rollout status statefulset/mongo --timeout=180s
kubectl -n commerce-flow rollout status deployment/redis --timeout=120s
kubectl -n commerce-flow rollout status deployment/kafka --timeout=240s
kubectl -n commerce-flow rollout status deployment/identity-service --timeout=240s
kubectl -n commerce-flow rollout status deployment/catalog-service --timeout=240s
kubectl -n commerce-flow rollout status deployment/inventory-service --timeout=240s
kubectl -n commerce-flow rollout status deployment/order-service --timeout=240s
kubectl -n commerce-flow rollout status deployment/payment-service --timeout=240s
kubectl -n commerce-flow rollout status deployment/notification-service --timeout=240s
kubectl -n commerce-flow rollout status deployment/api-gateway --timeout=240s

if ! kubectl -n kube-system get deployment metrics-server >/dev/null 2>&1; then
  kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml \
    || echo "metrics-server was not installed; the HorizontalPodAutoscaler stays idle until it is."
  kubectl -n kube-system patch deployment metrics-server --type=json \
    -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]' \
    || true
fi

echo "Cluster commerce-flow is up. Port-forward the gateway with: kubectl -n commerce-flow port-forward svc/api-gateway 3100:3000"
