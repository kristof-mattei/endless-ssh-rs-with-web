mod build_env;
mod cli;
mod client;
mod client_queue;
mod config;
mod db;
mod events;
mod ffi_wrapper;
mod geoip;
mod helpers;
mod line;
mod listener;
mod router;
mod sender;
mod server;
mod shutdown;
mod signal_handlers;
mod span;
mod state;
mod states;
mod statistics;
mod task_tracker_ext;
mod test_utils;
mod timeout;
mod traits;
mod utils;

use std::convert::Infallible;
use std::env::{self, VarError};
use std::net::SocketAddr;
use std::process::{ExitCode, Termination as _};
use std::sync::Arc;
use std::time::Duration;

use color_eyre::config::HookBuilder;
use color_eyre::eyre;
use dashmap::DashMap;
use dotenvy::dotenv;
use tokio::net::TcpStream;
use tokio::sync::{Semaphore, broadcast};
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use tracing::{Level, event};
use tracing_subscriber::layer::SubscriberExt as _;
use tracing_subscriber::util::SubscriberInitExt as _;
use tracing_subscriber::{EnvFilter, Layer as _};

use crate::build_env::get_build_env;
use crate::cli::parse_cli;
use crate::client::Client;
use crate::client_queue::process_clients;
use crate::config::Config;
use crate::events::{ActiveConnectionInfo, ClientEvent, WsEvent, database_listen_forever};
use crate::listener::listen_for_new_connections;
use crate::router::build_router;
use crate::server::setup_server;
use crate::shutdown::Shutdown;
use crate::state::ApplicationState;
use crate::statistics::{Statistics, statistics_sigusr1_handler};
use crate::task_tracker_ext::TaskTrackerExt as _;
use crate::utils::flatten_shutdown_handle;
use crate::utils::task::spawn_with_name;

#[cfg_attr(not(miri), global_allocator)]
#[cfg_attr(miri, expect(unused, reason = "Not supported in Miri"))]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

const SIZE_IN_BYTES: usize = 1;

fn build_filter() -> (EnvFilter, Option<eyre::Report>) {
    fn build_default_filter() -> EnvFilter {
        EnvFilter::builder()
            .parse(format!("INFO,{}=TRACE", env!("CARGO_CRATE_NAME")))
            .expect("Default filter should always work")
    }

    let (filter, parsing_error) = match env::var(EnvFilter::DEFAULT_ENV) {
        Ok(user_directive) => match EnvFilter::builder().parse(user_directive) {
            Ok(filter) => (filter, None),
            Err(error) => (build_default_filter(), Some(eyre::Report::new(error))),
        },
        Err(VarError::NotPresent) => (build_default_filter(), None),
        Err(error @ VarError::NotUnicode(_)) => {
            (build_default_filter(), Some(eyre::Report::new(error)))
        },
    };

    (filter, parsing_error)
}

fn init_tracing(filter: EnvFilter) -> Result<(), eyre::Report> {
    let registry = tracing_subscriber::registry();

    #[cfg(feature = "tokio-console")]
    let registry = registry.with(console_subscriber::ConsoleLayer::builder().spawn());

    Ok(registry
        .with(tracing_subscriber::fmt::layer().with_filter(filter))
        .with(tracing_error::ErrorLayer::default())
        .try_init()?)
}

fn main() -> ExitCode {
    // set up .env, if it fails, user didn't provide any
    let _r = dotenv();

    HookBuilder::default()
        .capture_span_trace_by_default(true)
        .display_env_section(false)
        .install()
        .expect("Failed to install panic handler");

    let (env_filter, parsing_error) = build_filter();

    init_tracing(env_filter).expect("Failed to set up tracing");

    // bubble up the parsing error
    if let Err(error) = parsing_error.map_or(Ok(()), Err) {
        return Err::<Infallible, _>(error).report();
    }

    // initialize the runtime
    let shutdown: Shutdown = tokio::runtime::Builder::new_multi_thread()
        .enable_io()
        .enable_time()
        .build()
        .expect("Failed building the Runtime")
        .block_on(async {
            // explicitly launch everything in a spawned task
            // see https://docs.rs/tokio/latest/tokio/attr.main.html#non-worker-async-function
            let handle = spawn_with_name("main task runner", start_tasks());

            flatten_shutdown_handle(handle).await
        });

    shutdown.report()
}

fn print_header() {
    const NAME: &str = env!("CARGO_PKG_NAME");
    const VERSION: &str = env!("CARGO_PKG_VERSION");

    let build_env = get_build_env();

    event!(
        Level::INFO,
        "{} v{} - built for {} ({})",
        NAME,
        VERSION,
        build_env.get_target(),
        build_env.get_target_cpu().unwrap_or("base cpu variant"),
    );
}

fn get_config() -> Result<Arc<Config>, eyre::Report> {
    let config = Arc::new(parse_cli().inspect_err(|error| {
        // this prints the error in color and exits
        // can't do anything else until
        // https://github.com/clap-rs/clap/issues/2914
        // is merged in
        if let Some(clap_error) = error.downcast_ref::<clap::error::Error>() {
            clap_error.exit();
        }
    })?);

    Ok(config)
}

/// starts all the tasks, such as the web server, the key refresh, ...
/// ensures all tasks are gracefully shutdown in case of error, `CTRL+c` or `SIGTERM`.
#[expect(clippy::too_many_lines, reason = "Entrypoint")]
async fn start_tasks() -> Shutdown {
    print_header();

    let config = match get_config() {
        Ok(config) => config,
        Err(error) => return Shutdown::from(error),
    };

    config.log();

    let Ok(database_url) = env::var("DATABASE_URL") else {
        event!(Level::ERROR, "DATABASE_URL environment variable is not set");

        return Shutdown::from(eyre::eyre!("DATABASE_URL not set"));
    };

    let db_pool = match db::create_pool(&database_url).await {
        Ok(pool) => pool,
        Err(error) => {
            event!(Level::ERROR, ?error, "Failed to connect to database");
            return Shutdown::from(eyre::Report::new(error));
        },
    };

    if let Err(error) = db::run_migrations(&db_pool).await {
        event!(Level::ERROR, ?error, "Failed to run database migrations");

        return Shutdown::from(eyre::Report::new(error));
    }

    event!(Level::INFO, "Database ready");

    let geo_ip = match std::env::var("MAXMIND_LICENSE_KEY") {
        Ok(key) if !key.is_empty() => Arc::new(geoip::try_init(&key).await),
        _ => {
            event!(
                Level::INFO,
                "`MAXMIND_LICENSE_KEY` not set, GeoIP lookup will be disabled"
            );

            Arc::new(None)
        },
    };

    let (internal_events_tx, internal_events_rx) = tokio::sync::mpsc::channel::<ClientEvent>(1000);
    let (ws_broadcast_tx, _ws_broadcast_rx) = broadcast::channel::<WsEvent>(1000);
    let active_connections: Arc<DashMap<SocketAddr, ActiveConnectionInfo>> =
        Arc::new(DashMap::new());

    // this channel is used to communicate between
    // tasks and this function, in the case that a task fails, they'll send a message on the shutdown channel
    // after which we'll gracefully terminate other services
    let cancellation_token = CancellationToken::new();
    let client_cancellation_token = CancellationToken::new();
    let statistics_cancellation_token = CancellationToken::new();

    let (statistics_sender, statistics_join_handle) =
        Statistics::new(statistics_cancellation_token.clone());

    // clients channel
    let (client_sender, client_receiver) =
        tokio::sync::mpsc::unbounded_channel::<Client<TcpStream>>();

    // available slots semaphore
    let semaphore = Arc::new(Semaphore::new(config.max_clients.get().into()));

    let application_state = ApplicationState::new(
        states::config::Config {},
        db_pool.clone(),
        Arc::clone(&geo_ip),
        ws_broadcast_tx.clone(),
        Arc::clone(&active_connections),
    );

    let tasks = TaskTracker::new();

    tasks.spawn_with_name(
        "server",
        set_up_server(application_state, cancellation_token.clone()),
    );

    tasks.spawn_with_name(
        "connection listener",
        listen_for_new_connections(
            Arc::clone(&config),
            cancellation_token.clone(),
            client_sender.clone(),
            internal_events_tx,
            Arc::clone(&semaphore),
            statistics_sender.clone(),
        ),
    );

    // listen to new connection channel, convert into client, push to client channel
    let process_clients_handler = tasks.spawn_with_name(
        "client processor",
        process_clients(
            client_cancellation_token.clone(),
            config.delay,
            config.max_line_length,
            client_sender.clone(),
            client_receiver,
            statistics_sender.clone(),
        ),
    );

    tasks.spawn_with_name(
        "sigusr1 handler",
        statistics_sigusr1_handler(cancellation_token.clone(), statistics_sender.clone()),
    );

    {
        let cancellation_token = cancellation_token.clone();
        let db_pool = db_pool.clone();
        let geo_ip = Arc::clone(&geo_ip);
        let ws_broadcast_tx = ws_broadcast_tx.clone();
        let active_connections = Arc::clone(&active_connections);

        tasks.spawn(async move {
            let _guard = cancellation_token.clone().drop_guard();

            database_listen_forever(
                cancellation_token.clone(),
                db_pool,
                geo_ip,
                internal_events_rx,
                ws_broadcast_tx,
                active_connections,
            )
            .await;
        });
    }

    // done enrolling tasks in this tracker
    tasks.close();

    // now we wait forever for either
    // * SIGTERM
    // * CTRL+c (SIGINT)
    // * a message on the shutdown channel, sent either by the server task or
    // another task when they complete (which means they failed)
    tokio::select! {
        result = signal_handlers::wait_for_sigterm() => {
            if let Err(error) = result {
                event!(Level::ERROR, ?error, "Failed to register SIGERM handler, aborting");
            } else {
                // we completed because ...
                event!(Level::WARN, "Sigterm detected, stopping all tasks");
            }
        },
        result = signal_handlers::wait_for_sigint() => {
            if let Err(error) = result {
                event!(Level::ERROR, ?error, "Failed to register CTRL+c handler, aborting");
            } else {
                // we completed because ...
                event!(Level::WARN, "CTRL+c detected, stopping all tasks");
            }
        },
        () = cancellation_token.cancelled() => {
            event!(Level::WARN, "Underlying task stopped, stopping all others tasks");
        },
    }

    // backup, in case we forgot a dropguard somewhere
    cancellation_token.cancel();

    client_cancellation_token.cancel();

    if timeout(Duration::from_secs(10), process_clients_handler)
        .await
        .is_err()
    {
        event!(
            Level::ERROR,
            "Client processor didn't stop within allotted time!"
        );
    }

    {
        // cancel the statistics handler now that the client processor is gone
        statistics_cancellation_token.cancel();

        // wait for abort and do a final abort
        match statistics_join_handle.await {
            Ok(statistics) => {
                statistics.log_totals();
            },
            Err(error) => {
                return Shutdown::from(error);
            },
        }
    }

    // wait for the other tasks to shut down gracefully
    if timeout(Duration::from_secs(10), tasks.wait())
        .await
        .is_err()
    {
        event!(Level::ERROR, "Tasks didn't stop within allotted time!");
    }

    event!(Level::INFO, "Done");

    Shutdown::Success
}

async fn set_up_server(application_state: ApplicationState, cancellation_token: CancellationToken) {
    let bind_to = SocketAddr::from(([0, 0, 0, 0], 3000));
    let router = build_router(application_state);

    let _guard = cancellation_token.clone().drop_guard();

    match setup_server(bind_to, router, cancellation_token).await {
        Err(error) => {
            event!(Level::ERROR, ?error, "Webserver died");
        },
        Ok(()) => {
            event!(Level::INFO, "Webserver shut down gracefully");
        },
    }
}
