# Python-capable sandbox image — the manifest.image recipe in miniature.
#
# The platform only runs images built FROM its own sandbox base image (the
# entrypoint contract: S3 workspace sync, `timeout` wrapping, uid 10001) and
# pulled from the SAME ECR repo under a different tag. Build and push:
#
#   REPO="$(aws ecr describe-repositories \
#     --repository-names agent-village-dev-sandbox-base \
#     --query 'repositories[0].repositoryUri' --output text)"
#   aws ecr get-login-password | docker login --username AWS --password-stdin "${REPO%%/*}"
#   docker build --platform linux/arm64 --build-arg BASE_IMAGE="$REPO:latest" -t "$REPO:python" .
#   docker push "$REPO:python"
#
# then set `"image": "python"` in the application's manifest. The launcher
# clones the deployed task definition with this tag (packages/services/
# src/sandbox-taskdef.ts); everything else — roles, egress proxy, uid pin,
# cpu/memory — is inherited unchanged.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}

# Root only for the package install; the platform pins the app container to
# uid 10001 anyway, but keep the image's own USER honest too.
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*
USER 10001

# The base entrypoint still wraps every run; only the default command changes.
CMD ["python3", "--version"]
