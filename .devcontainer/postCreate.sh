#!/usr/bin/env bash

rustc --version

rustup toolchain add nightly
rustup component add --toolchain nightly rustfmt

cargo install sqlx-cli --no-default-features --features postgres

cargo sqlx migrate run --source ./crates/endless-ssh-rs-with-web/migrations

# the named volume mounts as root, pnpm runs as the remote user
sudo chown "$(id --user):$(id --group)" node_modules

pnpm install
