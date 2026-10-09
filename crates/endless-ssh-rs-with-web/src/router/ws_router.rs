use std::time::Duration;

use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::IntoResponse;
use tokio::sync::broadcast;
use tracing::{Level, event};

use crate::build_env::COMPILE_TIME_BUILD_ID;
use crate::db::types::AllTimeTotals;
use crate::events::{ActiveConnectionInfo, ConnectionFrame, WsEvent};
use crate::state::ApplicationState;
use crate::utils::serde::Elapsed;

/// The client's watchdog assumes a multiple of this before declaring the connection half-dead.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<ApplicationState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        // this resolves when the client is gone
        let _r = handle_socket(socket, state).await;
    })
}

async fn send_init_payload(
    socket: &mut WebSocket,
    active_connections: Vec<ActiveConnectionInfo>,
    totals: &AllTimeTotals,
) -> Result<(), ()> {
    let init_payload = match serde_json::to_string(&WsEvent::Init {
        build_id: COMPILE_TIME_BUILD_ID,
        active_connections,
        total_connections: totals.total_connections,
        total_bytes_sent: totals.total_bytes_sent,
        total_time_spent: Elapsed(totals.total_time_spent.0),
        last_counted_id: totals.last_counted_id,
    }) {
        Ok(s) => s,
        Err(error) => {
            event!(Level::ERROR, ?error, "Failed to serialize init message");

            return Err(());
        },
    };

    if socket
        .send(Message::Text(init_payload.into()))
        .await
        .is_err()
    {
        return Err(());
    }

    Ok(())
}

async fn send_ready_payload(socket: &mut WebSocket) -> Result<(), ()> {
    if socket
        .send(Message::Text(
            serde_json::to_string(&WsEvent::Ready).unwrap().into(),
        ))
        .await
        .is_err()
    {
        return Err(());
    }

    Ok(())
}

async fn handle_socket(mut socket: WebSocket, state: ApplicationState) -> Result<(), ()> {
    // subscribe to the WS broadcast channel BEFORE loading the snapshot so we don't miss events that arrive between the load and the loop start
    let mut broadcast_rx = state.ws_broadcast.subscribe();

    // build and send the init message, which is a snapshot of live connections
    let active: Vec<_> = state
        .active_connections
        .iter()
        .map(|v| v.value().clone())
        .collect::<Vec<ActiveConnectionInfo>>();

    let snapshot = state.dashboard_snapshot.load_full();

    send_init_payload(&mut socket, active, &snapshot.totals).await?;

    // replay history, the most recent connections
    for frame in &snapshot.recent {
        if socket.send(frame.clone().into()).await.is_err() {
            return Err(());
        }
    }

    // signal that history replay is done.
    send_ready_payload(&mut socket).await?;

    // forward live broadcast events
    let mut heartbeat = tokio::time::interval(HEARTBEAT_INTERVAL);

    loop {
        tokio::select! {
            biased;

            // incoming messages from the client (ping/close/etc.)
            msg = socket.recv() => {
                match msg {
                    None | Some(Ok(Message::Close(_)) | Err(_)) => return Err(()),
                    _ => {} // don't care for the rest
                }
            },

            // outgoing events from the broadcast channel
            recv = broadcast_rx.recv() => {
                handle_broadcast(&mut socket, recv).await?;
            },

            // browsers cannot observe protocol pings, so liveness needs an application-level message
            _ = heartbeat.tick() => {
                if socket
                    .send(Message::Text(
                        serde_json::to_string(&WsEvent::Heartbeat).unwrap().into(),
                    ))
                    .await
                    .is_err()
                {
                    return Err(());
                }
            },
        }
    }
}

async fn handle_broadcast(
    socket: &mut WebSocket,
    recv: Result<ConnectionFrame, tokio::sync::broadcast::error::RecvError>,
) -> Result<(), ()> {
    match recv {
        Ok(frame) => {
            if socket.send(frame.into()).await.is_err() {
                return Err(());
            }
        },
        Err(broadcast::error::RecvError::Lagged(amount_lagged)) => {
            // the reconnect sends a fresh `init` and replays the most recent connections
            event!(
                Level::WARN,
                amount_lagged,
                "WS client lagged, closing the socket"
            );

            return Err(());
        },
        Err(broadcast::error::RecvError::Closed) => {
            return Err(());
        },
    }

    Ok(())
}
