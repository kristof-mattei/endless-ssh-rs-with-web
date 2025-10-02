use tokio_util::sync::CancellationToken;

use crate::BROADCAST_CHANNEL;

pub async fn database_listen_forever(cancellation_token: CancellationToken) {
    let receiver = &mut BROADCAST_CHANNEL.subscribe();

    loop {
        tokio::select! {
            biased;
            () = cancellation_token.cancelled() => {
                break;
            },
            result = receiver.recv() => {
                match result {
                    Ok(_) => todo!(),
                    Err(_) => todo!(),
                }
                // ...
            }
        }
    }
}

#[derive(Clone)]
pub enum ClientEvent {}
