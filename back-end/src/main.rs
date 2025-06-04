mod cli;
mod client;
mod client_queue;
mod config;
mod events;
mod ffi_wrapper;
mod helpers;
mod line;
mod listener;
mod sender;
mod server;
mod signal_handlers;
mod statistics;
mod timeout;
mod traits;
mod utils;

use std::env::{self, VarError};
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use client::Client;
use client_queue::process_clients_forever;
use color_eyre::config::HookBuilder;
use color_eyre::eyre;
use dotenvy::dotenv;
use events::{ClientEvent, database_listen_forever};
use listener::listen_forever;
use server::server_forever;
use tokio::net::TcpStream;
use tokio::sync;
use tokio::sync::{RwLock, Semaphore};
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;
use tracing::{Level, event};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, Layer};

use crate::cli::parse_cli;
use crate::statistics::Statistics;

const SIZE_IN_BYTES: usize = 1;

static BROADCAST_CHANNEL: LazyLock<sync::broadcast::Sender<ClientEvent>> =
    LazyLock::new(|| sync::broadcast::channel(100).0);

async fn start_tasks() -> Result<(), eyre::Report> {
    let statistics = Arc::new(RwLock::new(Statistics::new()));

    let config = Arc::new(parse_cli().inspect_err(|error| {
        // this prints the error in color and exits
        // can't do anything else until
        // https://github.com/clap-rs/clap/issues/2914
        // is merged in
        if let Some(clap_error) = error.downcast_ref::<clap::error::Error>() {
            clap_error.exit();
        }
    })?);

    config.log();

    let bind_to = ([0, 0, 0, 0], 3000).into();

    // TODO
    let router = axum::Router::new();

    // clients channel
    let (client_sender, client_receiver) =
        tokio::sync::mpsc::channel::<Client<TcpStream>>(config.max_clients.into());

    // available slots semaphore
    let semaphore = Arc::new(Semaphore::new(config.max_clients.into()));

    // this channel is used to communicate between
    // tasks and this function, in the case that a task fails, they'll send a message on the shutdown channel
    // after which we'll gracefully terminate other services
    let token = CancellationToken::new();

    let mut tasks = tokio::task::JoinSet::new();

    {
        let token = token.clone();

        tasks.spawn(server_forever(bind_to, router, token.clone()));
    }

    {
        tasks.spawn(listen_forever(
            client_sender.clone(),
            semaphore.clone(),
            config.clone(),
            statistics.clone(),
        ));
    }

    {
        // listen to new connection channel, convert into client, push to client channel
        tasks.spawn(process_clients_forever(
            client_sender.clone(),
            client_receiver,
            semaphore.clone(),
            config.clone(),
            statistics.clone(),
        ));
    }

    {
        let statistics = statistics.clone();

        tasks.spawn(async move {
            while let Some(()) = signal_handlers::wait_for_sigusr1().await {
                statistics.read().await.log_totals::<()>(&[]);
            }
        });
    }

    {
        tasks.spawn(async move {
            database_listen_forever().await;
        });
    }

    // now we wait forever for either
    // * SIGTERM
    // * ctrl + c (SIGINT)
    // * a message on the shutdown channel, sent either by the server task or
    // another task when they complete (which means they failed)
    tokio::select! {
        _ = signal_handlers::wait_for_sigint() => {
            // we completed because ...
            event!(Level::WARN, message = "CTRL+C detected, stopping all tasks");
        },
        _ = tasks.join_next() => {},
        _ = signal_handlers::wait_for_sigterm() => {
            // we completed because ...
            event!(Level::WARN, message = "Sigterm detected, stopping all tasks");
        },
        () = token.cancelled() => {
            event!(Level::WARN, "Underlying task stopped, stopping all others tasks");
        },
    };

    // backup, in case we forgot a dropguard somewhere
    token.cancel();

    // wait for the task that holds the server to exit gracefully
    // it listens to shutdown_send
    if timeout(Duration::from_millis(10000), tasks.shutdown())
        .await
        .is_err()
    {
        event!(Level::ERROR, "Tasks didn't stop within allotted time!");
    }

    {
        (statistics.read().await).log_totals::<()>(&[]);
    }

    event!(Level::INFO, "Goodbye");

    Ok(())
}

fn build_default_filter() -> EnvFilter {
    EnvFilter::builder()
        .parse(format!("INFO,{}=TRACE", env!("CARGO_CRATE_NAME")))
        .expect("Default filter should always work")
}

fn init_tracing() -> Result<(), eyre::Report> {
    let (filter, filter_parsing_error) = match env::var(EnvFilter::DEFAULT_ENV) {
        Ok(user_directive) => match EnvFilter::builder().parse(user_directive) {
            Ok(filter) => (filter, None),
            Err(error) => (build_default_filter(), Some(eyre::Report::new(error))),
        },
        Err(VarError::NotPresent) => (build_default_filter(), None),
        Err(error @ VarError::NotUnicode(_)) => {
            (build_default_filter(), Some(eyre::Report::new(error)))
        },
    };

    let registry = tracing_subscriber::registry();

    #[cfg(feature = "tokio-console")]
    let registry = registry.with(console_subscriber::ConsoleLayer::builder().spawn());

    registry
        .with(tracing_subscriber::fmt::layer().with_filter(filter))
        .with(tracing_error::ErrorLayer::default())
        .try_init()?;

    filter_parsing_error.map_or(Ok(()), Err)
}

fn main() -> Result<(), eyre::Report> {
    // set up .env, if it fails, user didn't provide any
    let _r = dotenv();

    HookBuilder::default()
        .capture_span_trace_by_default(true)
        .display_env_section(false)
        .install()?;

    init_tracing()?;

    // initialize the runtime
    let rt = tokio::runtime::Runtime::new().unwrap();

    // start service
    let result: Result<(), eyre::Report> = rt.block_on(start_tasks());

    result
}
