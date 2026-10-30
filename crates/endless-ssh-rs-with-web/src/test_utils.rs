#![cfg(test)]

use crate::cli;
use crate::config::Config;

#[expect(unused, reason = "Library code")]
pub(crate) fn build_config() -> Config {
    let config = cli::parse_cli_from(["...", "--database-url", "postgres://localhost"]).unwrap();

    config
}
