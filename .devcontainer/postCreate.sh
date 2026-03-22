rustc --version

rustup toolchain add nightly
rustup component add --toolchain nightly rustfmt

cargo install sqlx-cli --no-default-features --features postgres

cargo sqlx migrate run --source ./crates/endless-ssh-rs-with-web/migrations
