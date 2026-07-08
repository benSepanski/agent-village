# python-sandbox-image — custom `manifest.image` recipe

A worked example of running a **non-Node runtime** in the sandbox (Phase 4
step 03): a Dockerfile that layers Python 3 onto the platform's sandbox base
image, pushed to the **same** ECR repo under a new tag. This is the apply-bot
unblock in miniature — any app needing extra runtimes follows this shape.

The contract (`ApplicationManifest.image` in
[`manifest.ts`](../../packages/shared/src/schemas/manifest.ts)):

- `image` is a **tag in the platform's `<prefix>-sandbox-base` ECR repo**, not
  a free URI. The literal `sandbox-base` means the static task definition
  (the base image, no clone).
- Any other tag must name an image **built `FROM` the base image** so the
  entrypoint contract holds: S3 workspace sync, `timeout` wrapping, and the
  non-root uid 10001. Pushing to the base repo keeps the execution role's pull
  permissions (and ADR 0003's egress posture) unchanged.

## Build and push

See the comment block in the [`Dockerfile`](Dockerfile) for copy-paste
commands: `docker build --platform linux/arm64 --build-arg BASE_IMAGE=<repo>:latest`
then `docker push <repo>:python` (the sandbox tasks run on ARM64 Fargate).

## Use it from a manifest

```json
{
  "name": "my-python-app",
  "image": "python",
  "command": ["python3", "/workspace/my-python-app/main.py"],
  "schedule": null
}
```

On first launch with a new tag the launcher describes the deployed task
definition, clones it with the app container pointed at that tag, registers it
under the same family, and caches the result on the agent record — later runs
reuse it, and a platform redeploy invalidates the cache automatically.
