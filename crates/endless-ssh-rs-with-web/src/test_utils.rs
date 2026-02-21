#![cfg(test)]

use crate::cli;
use crate::config::Config;

#[expect(unused, reason = "Library code")]
pub fn build_config() -> Config {
    let config = cli::parse_cli_from(["..."]).unwrap();

    config
}
