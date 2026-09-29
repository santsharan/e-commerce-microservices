# Kubernetes

`make k8s-up` creates a [kind](https://kind.sigs.k8s.io/) cluster named `commerce-flow` and applies `infra/kubernetes/overlays/dev`. `make k8s-down` deletes that cluster. The first run installs `kind` and `kubectl` with Homebrew when they are missing.

The Docker VM is about 4 GB. Compose and the cluster do not both fit, so `make k8s-up` stops the Compose containers and keeps their volumes. `docker compose --profile full up -d` starts Compose again after the cluster is deleted, or alongside it once the VM has more memory.

## Layout

`infra/kubernetes/base` is the shared set. `overlays/dev` is the local cluster. `overlays/prod` raises the gateway and catalog to two replicas and sets `NODE_ENV=production`. It keeps the local image tags. CI publishes `ghcr.io/<owner>/<repository>/<service>:<git-sha>` and `:main`.

Each application has a Deployment, a Service, resource requests and limits, a liveness probe on `/health/liveness`, a readiness probe on `/health/readiness`, and a 30 second termination grace period. A `preStop` sleep gives the endpoints time to leave the Service before SIGTERM. The gateway, catalog, and order Deployments have a HorizontalPodAutoscaler with a minimum of 1 and a maximum of 3. Identity, inventory, payment, and notification stay at one replica on a laptop. They are safe to scale later: HTTP is stateless and the Kafka consumers use consumer groups.

## Data and keys

MongoDB is one pod, `mongo-0`, in a headless Service. The Service publishes the pod address before it is ready, so the startup script can initiate replica set `rs0` with member `mongo-0.mongo.commerce-flow.svc.cluster.local:27017`. Redis is one pod with no password. Kafka is one KRaft broker advertised as `kafka:9092`. A sidecar creates the catalog topics with three partitions. Disks are `emptyDir`, so a new pod starts empty.

`make k8s-up` creates Secret `commerce-flow-jwt` from `secrets/jwt-private.pem` and `secrets/jwt-public.pem`. Those files are not written into the manifests. Identity mounts both keys at `/var/commerce-flow/jwt`. The gateway mounts only the public key there. That path stays off `/run/secrets`, which Kubernetes uses for the service account token. The other services do not mount the Secret.

The gateway calls:

| Upstream  | URL                             |
| --------- | ------------------------------- |
| Identity  | `http://identity-service:3001`  |
| Catalog   | `http://catalog-service:3002`   |
| Inventory | `http://inventory-service:3003` |
| Order     | `http://order-service:3004`     |

Payment HTTP stays on `payment-service:3005` and is not an upstream. The in-cluster config does not set `OTEL_EXPORTER_OTLP_ENDPOINT`. Each pod still serves `GET /metrics`. Prometheus in the same namespace scrapes the gateway and the six services on that path and keeps six hours of samples. Open it with `kubectl -n commerce-flow port-forward svc/prometheus 9090:9090`. Grafana reads that Prometheus and serves the Kafka order-flow dashboard at `kubectl -n commerce-flow port-forward svc/grafana 3007:3000`, then `http://127.0.0.1:3007/d/commerce-kafka-flow`. The local login is `admin` / `admin`; anonymous viewers can open the dashboard. Process logs stay on each pod; Prometheus does not store them. The Compose collector remains the local trace pipeline.

## Network policy

The namespace denies ingress and egress, then allows DNS, the data ports, gateway ingress on 3000, and ingress to identity, catalog, inventory, and order from the gateway. Prometheus may scrape `/metrics` on the gateway and the services, and it may call the API server on port 443 for pod discovery. Grafana may read Prometheus on port 9090. Payment and notification accept no other pod ingress. kind's default CNI does not enforce NetworkPolicy. The rules are in the manifests for a cluster whose CNI implements them.

`make k8s-up` also applies metrics-server with `--kubelet-insecure-tls`, which kind needs before the HorizontalPodAutoscaler can read CPU.
