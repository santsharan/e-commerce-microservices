.PHONY: dev test test-e2e apps-up k8s-up k8s-down lint typecheck build format infra-up infra-down seed reset jwt-keys

lint:
	pnpm lint

format:
	pnpm format:check

typecheck:
	pnpm typecheck

test:
	pnpm test

test-e2e:
	pnpm test:e2e

apps-up:
	docker compose --profile full up -d --build --remove-orphans

k8s-up: jwt-keys
	bash scripts/k8s-up.sh

k8s-down:
	kind delete cluster --name commerce-flow

build:
	pnpm build

dev: build
	pnpm exec tsx scripts/wait-for-infra.ts
	pnpm exec tsx scripts/dev-services.ts

infra-up:
	docker compose up -d --remove-orphans
	pnpm exec tsx scripts/wait-for-infra.ts

infra-down:
	docker compose --profile apps --profile full down

jwt-keys:
	pnpm exec tsx scripts/generate-jwt-keys.ts

seed: build
	pnpm exec tsx scripts/seed.ts

reset: build
	pnpm exec tsx scripts/reset.ts --yes
