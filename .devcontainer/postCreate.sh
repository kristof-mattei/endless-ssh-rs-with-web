rustc --version

rustup toolchain add nightly
rustup component add --toolchain nightly rustfmt

cargo install sqlx-cli --features postgres
