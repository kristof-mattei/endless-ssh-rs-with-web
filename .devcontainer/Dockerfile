FROM mcr.microsoft.com/devcontainers/rust:2-1-trixie@sha256:1435dfe4083cddbb68e909b7ea6b370b2aa43e01a17f780e3410b422dfd93507

RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends mold
