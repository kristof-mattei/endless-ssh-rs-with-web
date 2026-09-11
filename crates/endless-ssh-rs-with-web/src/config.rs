use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::num::NonZeroU8;
use std::time::Duration;

use tracing::{Level, event};

pub const DEFAULT_DELAY: Duration = Duration::from_secs(10);
pub const DEFAULT_MAX_LINE_LENGTH: NonZeroU8 = NonZeroU8::new(32).unwrap();
pub const DEFAULT_MAX_CLIENTS: NonZeroU8 = NonZeroU8::new(64).unwrap();
pub const DEFAULT_SSH_LISTEN_ADDRESS: SocketAddr =
    SocketAddr::new(IpAddr::V6(Ipv6Addr::UNSPECIFIED), 2223);
pub const DEFAULT_HTTP_LISTEN_ADDRESS: SocketAddr =
    SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 3000);

#[derive(Debug, PartialEq, Eq)]
pub struct Config {
    pub delay: Duration,
    pub http_listen_address: SocketAddr,
    pub max_clients: NonZeroU8,
    pub max_line_length: NonZeroU8,
    pub ssh_listen_address: SocketAddr,
}

impl Default for Config {
    fn default() -> Self {
        Config::new()
    }
}

impl Config {
    pub fn new() -> Self {
        Self {
            delay: DEFAULT_DELAY,
            max_line_length: DEFAULT_MAX_LINE_LENGTH,
            max_clients: DEFAULT_MAX_CLIENTS,
            http_listen_address: DEFAULT_HTTP_LISTEN_ADDRESS,
            ssh_listen_address: DEFAULT_SSH_LISTEN_ADDRESS,
        }
    }

    pub fn log(&self) {
        event!(
            Level::INFO,
            "Delay: {}",
            humantime::format_duration(self.delay)
        );
        event!(Level::INFO, "MaxLineLength: {}", self.max_line_length);
        event!(Level::INFO, "MaxClients: {}", self.max_clients);
        event!(
            Level::INFO,
            "HttpListenAddress: {}",
            self.http_listen_address
        );
        event!(Level::INFO, "SshListenAddress: {}", self.ssh_listen_address);
    }
}
