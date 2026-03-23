# endless-ssh-rs-with-web

An SSH honeypot that traps scanners by slowly, but endlessly feeding them random data.

Inspired by [endless-ssh](https://github.com/skeeto/endlessh), rewritten in Rust with a PostgreSQL/TimescaleDB backend and a React frontend.

# Releases

Releases can be found [here](https://github.com/kristof-mattei/endless-ssh-rs-with-web/releases).

## How It Works

When an attacker connects to the SSH tarpit port, the server never completes the SSH handshake. Instead, it sends a slow trickle of random banner lines indefinitely, wasting the attacker's time and resources. All connections are logged with geolocation data (via MaxMind GeoLite2) and stored in a time-series database for visualization.

The web dashboard shows:

- A live world map with attacker locations
- A real-time event feed of connections and disconnections
- Aggregate statistics (total connections, bytes sent, time wasted)
- Historical charts with selectable time ranges

## Requirements

- Rust 1.94.0+
- Node.js 24.14.0
- pnpm 10.32.1
- PostgreSQL 18 + TimescaleDB
- Docker / Docker Compose (optional, for local development)

## Getting Started

**1. Start the database**

```bash
docker compose up --detach
```

**2. Build the frontend**

```bash
pnpm run build
```

**3. Build and run the backend**

```bash
SQLX_OFFLINE=true cargo run --release --package endless-ssh-rs-with-web
```

The web dashboard is served on port 3000. The SSH honeypot listens on port 2223 by default.

## Configuration

### CLI flags

| Flag                      | Default | Description                          |
| ------------------------- | ------- | ------------------------------------ |
| `-p`, `--port`            | `2223`  | Honeypot listening port              |
| `-d`, `--delay`           | `10000` | Delay between messages (ms)          |
| `-l`, `--max-line-length` | `32`    | Max banner line length (3–255 bytes) |
| `-m`, `--max-clients`     | `64`    | Max concurrent connections           |
| `-4`, `--only_4`          | —       | Bind to IPv4 only                    |
| `-6`, `--only_6`          | —       | Bind to IPv6 only                    |

### Environment variables

| Variable              | Description                                          |
| --------------------- | ---------------------------------------------------- |
| `DATABASE_URL`        | PostgreSQL connection string                         |
| `MAXMIND_LICENSE_KEY` | MaxMind license key for GeoIP lookups (optional)     |
| `RUST_LOG`            | Log level, e.g. `INFO,endless-ssh-rs-with-web=TRACE` |

## Docker

Multi-stage Docker builds produce a minimal scratch-based image. Multi-platform images (amd64, arm64) can be built with:

```bash
./build-all.sh
```

## Frontend Development

```bash
pnpm run dev       # Dev server with HMR
pnpm run build     # Production build
```

## Tech Stack

**Backend**: Rust, Axum, Tokio, SQLx, PostgreSQL, TimescaleDB, MaxMind GeoLite2

**Frontend**: React 19, TypeScript, Vite, Tailwind CSS, MapLibre GL, Recharts

## License

MIT, see [LICENSE](./LICENSE)

`SPDX-License-Identifier: MIT`
