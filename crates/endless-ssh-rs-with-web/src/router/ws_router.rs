use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::IntoResponse;
use serde::Deserialize;
use tokio::sync::broadcast;
use tracing::{Level, event};

use crate::db::{self, ConnectionRecord};
use crate::events::{ActiveConnectionInfo, WsEvent};
use crate::state::ApplicationState;

#[derive(Debug, Deserialize)]
pub struct WsQueryParams {
    /// Client sends the last event seq it received; we replay everything after it.
    pub since: Option<i64>,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<WsQueryParams>,
    State(state): State<ApplicationState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        // this resolves when the client is gone
        let _r = handle_socket(socket, params, state).await;
    })
}

async fn send_init_payload(
    socket: &mut WebSocket,
    active_connections: Vec<ActiveConnectionInfo>,
) -> Result<(), ()> {
    let init_payload = match serde_json::to_string(&WsEvent::Init { active_connections }) {
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

async fn send_connection_record(
    socket: &mut WebSocket,
    record: ConnectionRecord,
) -> Result<(), ()> {
    let ws_event = WsEvent::Disconnected {
        seq: record.id,
        ip: record.ip_address.to_string(),
        connected_at: record.connected_at,
        disconnected_at: record.disconnected_at,
        time_spent: record.time_spent,
        bytes_sent: usize::try_from(record.bytes_sent).unwrap_or(0),
        country_code: record.country_code,
        country_name: record.country_name,
        city: record.city,
        lat: record.latitude,
        lon: record.longitude,
    };
    match serde_json::to_string(&ws_event) {
        Ok(json) => {
            if socket.send(Message::Text(json.into())).await.is_err() {
                // client gone, abort
                return Err(());
            }
        },
        Err(error) => {
            event!(Level::ERROR, ?error, "Failed to serialize history event");
        },
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

async fn handle_socket(
    mut socket: WebSocket,
    params: WsQueryParams,
    state: ApplicationState,
) -> Result<(), ()> {
    // subscribe to the WS broadcast channel BEFORE querying the DB so we don't miss events that arrive between the query and the loop start
    let mut broadcast_rx = state.ws_broadcast.subscribe();

    // build and send the init message, which is a snapshot of live connections
    let active: Vec<_> = state
        .active_connections
        .iter()
        .map(|v| v.value().clone())
        .collect::<Vec<ActiveConnectionInfo>>();

    send_init_payload(&mut socket, active).await?;

    // replay history all connections with id > since
    let since_id = params.since.unwrap_or(0);

    match db::get_connections_since(&state.db_pool, since_id, 500).await {
        Ok(records) => {
            for rec in records {
                send_connection_record(&mut socket, rec).await?;
            }
        },
        Err(error) => {
            // don't abort, the client can still receive live events
            event!(Level::ERROR, ?error, "Failed to query connection history");
        },
    }

    // signal that history replay is done.
    send_ready_payload(&mut socket).await?;

    // forward live broadcast events, handling lag with a DB catch-up
    let mut last_seq: i64 = since_id;

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
                handle_broadcast(&mut socket, &state, recv, &mut last_seq).await?;
            },
        }
    }
}

async fn handle_broadcast(
    socket: &mut WebSocket,
    state: &ApplicationState,
    recv: Result<WsEvent, tokio::sync::broadcast::error::RecvError>,
    last_seq: &mut i64,
) -> Result<(), ()> {
    match recv {
        Ok(ws_event) => {
            // track last seen seq for deduplication on reconnect
            // TODO this channel shouldn't use `WsEvent`, it should be a separate type
            if let &WsEvent::Disconnected { seq, .. } = &ws_event {
                *last_seq = seq;
            }

            // forward
            match serde_json::to_string(&ws_event) {
                Ok(json) => {
                    if socket.send(Message::Text(json.into())).await.is_err() {
                        return Err(());
                    }
                },
                Err(error) => {
                    event!(Level::ERROR, ?error, "Failed to serialize WS event");
                },
            }
        },
        Err(broadcast::error::RecvError::Lagged(amount_lagged)) => {
            event!(
                Level::WARN,
                amount_lagged,
                "WS client lagged, replaying missed events from DB"
            );

            // re-query DB for missed events
            match db::get_connections_since(&state.db_pool, *last_seq, 1000).await {
                Ok(records) => {
                    for rec in records {
                        *last_seq = rec.id;

                        send_connection_record(socket, rec).await?;
                    }
                },
                Err(error) => {
                    event!(Level::ERROR, ?error, "Failed to catch up after WS lag");
                },
            }
        },
        Err(broadcast::error::RecvError::Closed) => {
            return Err(());
        },
    }

    Ok(())
}
