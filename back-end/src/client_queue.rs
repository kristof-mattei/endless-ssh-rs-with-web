use std::sync::Arc;

use time::OffsetDateTime;
use tokio::net::TcpStream;
use tokio::sync::RwLock;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;
use tracing::{Level, event};

use crate::client::Client;
use crate::config::Config;
use crate::sender;
use crate::statistics::Statistics;

pub async fn process_clients_forever(
    config: Arc<Config>,
    cancellation_token: CancellationToken,
    client_sender: UnboundedSender<Client<TcpStream>>,
    mut client_receiver: UnboundedReceiver<Client<TcpStream>>,
    statistics: Arc<RwLock<Statistics>>,
) {
    let _guard = cancellation_token.clone().drop_guard();

    event!(Level::INFO, "Processing clients");

    loop {
        tokio::select! {
            biased;
            () = cancellation_token.cancelled() => {
                break;
            },
            received_client = client_receiver.recv() => {
                if let Some(client) = received_client {
                    if let Some(client) = process_client(client, &config, &statistics).await
                        && client_sender.send(client).is_err() {
                            event!(Level::ERROR, "Client sender gone");
                            break;
                        }
                } else {
                    event!(Level::ERROR, "Client receiver gone");
                    break;
                }
            },
        }
    }
}

async fn process_client<S>(
    mut client: Client<S>,
    config: &Config,
    statistics: &RwLock<Statistics>,
) -> Option<Client<S>>
where
    S: tokio::io::AsyncWriteExt + std::marker::Unpin + std::fmt::Debug,
{
    let now = OffsetDateTime::now_utc();

    if client.send_next > now {
        let until_ready = (client.send_next - now)
            .try_into()
            .expect("`send_next` is larger than `now`, so duration should be positive");

        event!(Level::TRACE, addr = ?client.addr, ?until_ready, "Scheduled client");

        sleep(until_ready).await;
    }

    {
        // TODO channel
        let mut guard = statistics.write().await;
        guard.processed_clients += 1;
    }

    event!(Level::DEBUG, addr = ?client.addr, "Processing client");

    if let Ok(bytes_sent) =
        sender::sendline(&mut client.tcp_stream, config.max_line_length.into()).await
    {
        client.bytes_sent += bytes_sent;
        client.time_spent += config.delay;

        {
            // TODO channel
            let mut guard = statistics.write().await;
            guard.bytes_sent += bytes_sent;
            guard.time_spent += config.delay;
        }

        // and delay again
        client.send_next = OffsetDateTime::now_utc() + config.delay;

        // Done processing, return
        Some(client)
    } else {
        {
            // TODO channel
            let mut guard = statistics.write().await;
            guard.lost_clients += 1;
        }

        event!(Level::TRACE, ?client, "Client gone");

        // can't process, don't return to queue.
        // Client will be dropped, connections terminated by libc::close
        // and permit will be returned
        None
    }
}
