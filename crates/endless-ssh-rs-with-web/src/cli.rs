use std::env;
use std::ffi::OsString;
use std::net::SocketAddr;
use std::num::NonZeroU8;
use std::time::Duration;

use clap::builder::TypedValueParser as _;
use clap::error::ErrorKind;
use clap::{ArgAction, Parser, value_parser};
use color_eyre::eyre;

use crate::config::{
    Config, DEFAULT_DELAY_MS, DEFAULT_HTTP_LISTEN_ADDRESS, DEFAULT_MAX_CLIENTS,
    DEFAULT_MAX_LINE_LENGTH, DEFAULT_SSH_LISTEN_ADDRESS,
};

fn delay_parser(value: &str) -> Result<Duration, clap::Error> {
    let timeout_ms = value
        .parse()
        .map_err(|_| clap::Error::new(ErrorKind::ValueValidation))?;

    Ok(Duration::from_millis(timeout_ms))
}

#[derive(Debug, Parser)]
#[command(disable_help_flag = true)]
pub struct Cli {
    #[clap(
        short = 'd',
        long = "delay",
        default_value = DEFAULT_DELAY_MS.to_string(),
        help = "Message millisecond delay",
        value_parser = delay_parser
    )]
    delay: Duration,

    #[clap(
        short = 'l',
        long = "max-line-length",
        default_value_t = DEFAULT_MAX_LINE_LENGTH,
        help = "Maximum banner line length (3-255)",
        value_parser = value_parser!(u8).range(3..=255).try_map(NonZeroU8::try_from)
    )]
    max_line_length: NonZeroU8,

    #[clap(
        short = 'm',
        long = "max-clients",
        default_value_t = DEFAULT_MAX_CLIENTS,
        help = "Maximum number of clients"
    )]
    max_clients: NonZeroU8,

    #[clap(
        long,
        env,
        default_value_t = DEFAULT_SSH_LISTEN_ADDRESS,
        help = "SSH listen address"
    )]
    ssh_listen_address: SocketAddr,

    #[clap(
        long,
        env,
        default_value_t = DEFAULT_HTTP_LISTEN_ADDRESS,
        help = "HTTP listen address"
    )]
    http_listen_address: SocketAddr,

    #[clap(
        short = 'h',
        long = "help",
        help = "Print this help message and exit",
        action = ArgAction::Help,
    )]
    help: (),
}

impl From<Cli> for Config {
    fn from(matches: Cli) -> Self {
        Config {
            delay: matches.delay,
            http_listen_address: matches.http_listen_address,
            max_clients: matches.max_clients,
            max_line_length: matches.max_line_length,
            ssh_listen_address: matches.ssh_listen_address,
        }
    }
}

pub fn parse_cli() -> Result<Config, eyre::Error> {
    parse_cli_from(env::args_os())
}

pub fn parse_cli_from<I, T>(from: I) -> Result<Config, eyre::Error>
where
    I: IntoIterator<Item = T>,
    T: Into<OsString> + Clone,
{
    Ok(Cli::try_parse_from(from)?.into())
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
    use std::num::NonZeroU8;

    use color_eyre::eyre;
    use pretty_assertions::{assert_eq, assert_matches};

    use super::parse_cli_from;
    use crate::config::Config;

    fn parse_factory(input: &'static str) -> Result<Config, eyre::Report> {
        // fake input
        let command_line = input.split_whitespace().collect::<Vec<&str>>();

        parse_cli_from(command_line)
    }

    #[test]
    fn bad_cli_options_1() {
        let result = parse_factory("foo bar");

        #[expect(unused_must_use, reason = "Testing")]
        result.unwrap_err();
    }

    #[test]
    fn bad_cli_options_2() {
        let result = parse_factory("endless-ssh-rs bar");

        #[expect(unused_must_use, reason = "Testing")]
        result.unwrap_err();
    }

    #[test]
    fn parses_delay() {
        let result = parse_factory("endless-ssh-rs --delay 100");

        let expected_config = Config {
            delay: std::time::Duration::from_millis(100),
            ..Config::default()
        };

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), expected_config);
    }

    #[test]
    fn parses_max_clients() {
        let result = parse_factory("endless-ssh-rs --max-clients 50");

        let expected_config = Config {
            max_clients: NonZeroU8::new(50).unwrap(),
            ..Config::default()
        };

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), expected_config);
    }

    #[test]
    fn parses_max_line_length() {
        let result = parse_factory("endless-ssh-rs --max-line-length 70");

        let expected_config = Config {
            max_line_length: NonZeroU8::new(70).unwrap(),
            ..Config::default()
        };

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), expected_config);
    }

    #[test]
    fn ensures_minimum_line_length() {
        let result = parse_factory("endless-ssh-rs --max-line-length 2");

        #[expect(unused_must_use, reason = "Testing")]
        result.unwrap_err();
    }

    #[test]
    fn rejects_zero_max_clients() {
        let result = parse_factory("endless-ssh-rs --max-clients 0");

        assert_matches!(result, Err(_));
    }

    #[test]
    fn parses_ssh_listen_address() {
        let result = parse_factory("endless-ssh-rs --ssh-listen-address 127.0.0.1:2000");

        let expected_config = Config {
            ssh_listen_address: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 2000),
            ..Config::default()
        };

        assert_matches!(result, Ok(config) if config == expected_config);
    }

    #[test]
    fn parses_http_listen_address() {
        let result = parse_factory("endless-ssh-rs --http-listen-address [::1]:9090");

        let expected_config = Config {
            http_listen_address: SocketAddr::new(IpAddr::V6(Ipv6Addr::LOCALHOST), 9090),
            ..Config::default()
        };

        assert_matches!(result, Ok(config) if config == expected_config);
    }

    #[test]
    fn defaults_http_listen_address_to_loopback() {
        let result = parse_factory("endless-ssh-rs");

        let expected_http = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 3000);

        assert_matches!(result, Ok(config) if config.http_listen_address == expected_http);
    }

    #[test]
    fn defaults_ssh_listen_address_to_wildcard() {
        let result = parse_factory("endless-ssh-rs");

        let expected_ssh = SocketAddr::new(IpAddr::V6(Ipv6Addr::UNSPECIFIED), 2223);

        assert_matches!(result, Ok(config) if config.ssh_listen_address == expected_ssh);
    }

    #[test]
    fn rejects_listen_address_without_port() {
        let result = parse_factory("endless-ssh-rs --http-listen-address 127.0.0.1");

        assert_matches!(result, Err(_));
    }
}
