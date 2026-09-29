# CI

Pull requests and pushes to `main` run `.github/workflows/ci.yml` on GitHub-hosted Ubuntu runners. Nothing in that workflow uses a developer machine.

The quality job installs with `pnpm install --frozen-lockfile`, then runs lint, Prettier, the typecheck, `pnpm test`, and `pnpm build`. `pnpm test` includes the event contract checks. The integration job runs `pnpm test:e2e`. That job needs Docker, which the runner provides. It listens on ports 3000–3005.

Images build only after both of those jobs pass. Each service image is loaded, scanned with Trivy, and left unpublished on a pull request. A critical vulnerability with a fix fails the scan. Findings without a fix are reported and do not fail the job. A push to `main` then publishes `ghcr.io/<owner>/<repository>/<service>:<git-sha>` and the `:main` tag. The package permission is the workflow's `GITHUB_TOKEN`. The prod Kubernetes overlay still points at the local image tags, so a publish does not roll a cluster by itself.

`.github/workflows/security.yml` runs on the same events and every Monday. It runs `pnpm audit` at high severity, CodeQL for JavaScript and TypeScript without a custom build, and gitleaks `v8.30.1` over the git history. Dependabot opens weekly updates for pnpm, GitHub Actions, the root Compose file, and `infra/docker/Dockerfile`.
