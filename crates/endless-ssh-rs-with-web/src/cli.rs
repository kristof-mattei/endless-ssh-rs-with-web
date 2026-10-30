#[cfg(test)]
use std::ffi::OsString;
use std::net::SocketAddr;
use std::num::NonZeroU8;
use std::time::Duration;

use clap::builder::TypedValueParser as _;
use clap::{Parser, value_parser};
#[cfg(test)]
use color_eyre::eyre;
use http::uri::Authority;
use sqlx::postgres::PgConnectOptions;

use crate::config::{
    Config, DEFAULT_DELAY, DEFAULT_HTTP_LISTEN_ADDRESS, DEFAULT_MAX_CLIENTS,
    DEFAULT_MAX_LINE_LENGTH, DEFAULT_SSH_LISTEN_ADDRESS, Services,
};

#[derive(Debug, Parser)]
#[command(about, version)]
pub(crate) struct Cli {
    #[arg(
        short = 'd',
        long,
        env,
        default_value = humantime::format_duration(DEFAULT_DELAY).to_string(),
        help = "Delay between messages, for example 10s or 500ms",
        value_parser = humantime::parse_duration
    )]
    delay: Duration,

    #[arg(
        short = 'l',
        long,
        env,
        default_value_t = DEFAULT_MAX_LINE_LENGTH,
        help = "Maximum banner line length (3-255)",
        value_parser = value_parser!(u8).range(3..=255).try_map(NonZeroU8::try_from)
    )]
    max_line_length: NonZeroU8,

    #[arg(
        short = 'm',
        long,
        env,
        default_value_t = DEFAULT_MAX_CLIENTS,
        help = "Maximum number of clients"
    )]
    max_clients: NonZeroU8,

    #[arg(
        long,
        env,
        default_value_t = DEFAULT_SSH_LISTEN_ADDRESS,
        help = "SSH listen address"
    )]
    ssh_listen_address: SocketAddr,

    #[arg(
        long,
        env,
        default_value_t = DEFAULT_HTTP_LISTEN_ADDRESS,
        help = "HTTP listen address"
    )]
    http_listen_address: SocketAddr,

    #[arg(
        long,
        env,
        hide_env_values = true,
        help = "PostgreSQL connection string"
    )]
    database_url: PgConnectOptions,

    #[arg(
        long,
        env,
        hide_env_values = true,
        help = "MaxMind license key for GeoIP lookups"
    )]
    maxmind_license_key: Option<String>,

    #[arg(
        long,
        env,
        help = "Vite dev server to proxy the front end to, instead of serving `dist`"
    )]
    front_end_proxy: Option<Authority>,
}

impl From<Cli> for (Config, Services) {
    fn from(matches: Cli) -> Self {
        let config = Config {
            delay: matches.delay,
            http_listen_address: matches.http_listen_address,
            max_clients: matches.max_clients,
            max_line_length: matches.max_line_length,
            ssh_listen_address: matches.ssh_listen_address,
        };

        let services = Services {
            database: matches.database_url,
            maxmind_license_key: matches.maxmind_license_key.filter(|key| !key.is_empty()),
            front_end_proxy: matches.front_end_proxy,
        };

        (config, services)
    }
}

#[cfg(test)]
pub(crate) fn parse_cli_from<I, T>(from: I) -> Result<Config, eyre::Error>
where
    I: IntoIterator<Item = T>,
    T: Into<OsString> + Clone,
{
    let (config, _services): (Config, Services) = Cli::try_parse_from(from)?.into();

    Ok(config)
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
    use std::num::NonZeroU8;

    use clap::{CommandFactory as _, Parser as _};
    use color_eyre::eyre;
    use http::uri::Authority;
    use pretty_assertions::{assert_eq, assert_matches};

    use super::{Cli, parse_cli_from};
    use crate::config::{Config, Services};

    fn parse_factory(input: &'static str) -> Result<Config, eyre::Report> {
        // fake input, with the required `--database-url`
        let command_line = input
            .split_whitespace()
            .chain(["--database-url", "postgres://localhost"])
            .collect::<Vec<&str>>();

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
        let result = parse_factory("endless-ssh-rs --delay 100ms");

        let expected_config = Config {
            delay: std::time::Duration::from_millis(100),
            ..Config::default()
        };

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), expected_config);
    }

    #[test]
    fn defaults_delay_to_ten_seconds() {
        let result = parse_factory("endless-ssh-rs");

        assert_matches!(result, Ok(config) if config.delay == std::time::Duration::from_secs(10));
    }

    #[test]
    fn rejects_delay_without_unit() {
        let result = parse_factory("endless-ssh-rs --delay 100");

        assert_matches!(result, Err(_));
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
    fn reads_every_option_from_the_environment() {
        let command = Cli::command();

        let env_names = command
            .get_arguments()
            .filter_map(|argument| argument.get_env()?.to_str())
            .collect::<Vec<&str>>();

        assert_eq!(
            env_names,
            [
                "DELAY",
                "MAX_LINE_LENGTH",
                "MAX_CLIENTS",
                "SSH_LISTEN_ADDRESS",
                "HTTP_LISTEN_ADDRESS",
                "DATABASE_URL",
                "MAXMIND_LICENSE_KEY",
                "FRONT_END_PROXY"
            ]
        );
    }

    #[test]
    fn rejects_listen_address_without_port() {
        let result = parse_factory("endless-ssh-rs --http-listen-address 127.0.0.1");

        assert_matches!(result, Err(_));
    }

    #[test]
    fn rejects_invalid_database_url() {
        let result = parse_cli_from(["endless-ssh-rs", "--database-url", "not a url"]);

        assert_matches!(result, Err(_));
    }

    #[test]
    fn ignores_empty_maxmind_license_key() {
        let cli = Cli::try_parse_from([
            "endless-ssh-rs",
            "--database-url",
            "postgres://localhost",
            "--maxmind-license-key",
            "",
        ])
        .unwrap();

        let (_, services): (Config, Services) = cli.into();

        assert_eq!(services.maxmind_license_key, None);
    }

    #[test]
    fn parses_front_end_proxy() {
        let cli = Cli::try_parse_from([
            "endless-ssh-rs",
            "--database-url",
            "postgres://localhost",
            "--front-end-proxy",
            "127.0.0.1:4000",
        ])
        .unwrap();

        let (_, services): (Config, Services) = cli.into();

        assert_eq!(
            services.front_end_proxy,
            Some(Authority::from_static("127.0.0.1:4000"))
        );
    }

    #[test]
    fn rejects_front_end_proxy_with_scheme() {
        let result = parse_factory("endless-ssh-rs --front-end-proxy http://127.0.0.1:4000");

        assert_matches!(result, Err(_));
    }
}
