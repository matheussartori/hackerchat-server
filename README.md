<h1 align="center">Hackerchat Server</h1>

<p align="center">
  A client-agnostic WebSocket chat server built with Node.js and TypeScript.
</p>

<p align="center">
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D24-brightgreen?logo=node.js&logoColor=white" alt="Node.js version" /></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-6-blue?logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License" /></a>
</p>

<p align="center">
  <a href="#overview">Overview</a> ·
  <a href="#features">Features</a> ·
  <a href="#requirements">Requirements</a> ·
  <a href="#running-locally">Running Locally</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#websocket-protocol">WebSocket Protocol</a> ·
  <a href="#deploying">Deploying</a> ·
  <a href="#development">Development</a> ·
  <a href="#related-projects">Related Projects</a>
</p>

---

## Overview

Hackerchat Server is an HTTP server that upgrades incoming connections to WebSocket and routes chat messages between users grouped into rooms. A room is created the moment its first user joins and is discarded once the last one leaves. All state lives in memory, so there is no database to provision.

The server is client-agnostic: anything that speaks WebSocket can connect to it, whether that is a browser app, a mobile app, a desktop app or a terminal client. It ships no frontend of its own.

## Features

- Room-based messaging, with rooms created on demand and dropped when they empty out
- RFC 6455 framing implemented in the project itself, so there is no WebSocket library in the runtime dependencies
- JSON protocol: one object per WebSocket text frame
- Incoming payloads capped at 1 MiB, with oversized frames closed under code `1009`
- Graceful shutdown: on `SIGTERM`/`SIGINT` every client receives a close frame before the process exits
- `/healthz` endpoint for load balancers and container health checks
- Structured logging with `pino`
- Environment variables parsed and validated with `zod` at startup
- Docker images and Compose files for local development and production
- Written in TypeScript

## Requirements

Node.js `24` or newer. The bundled npm (`10` or newer) is enough; no other tooling is required.

## Running Locally

**1. Clone the repository**

```bash
git clone https://github.com/matheussartori/hackerchat-server.git
cd hackerchat-server
```

**2. Install dependencies**

```bash
npm install
```

**3. Start the development server**

```bash
npm run dev
```

The server listens on port **9898** by default. Pass `PORT` to change it:

```bash
PORT=3000 npm run dev
```

The dev script runs the TypeScript sources through `tsx` and restarts on every file change, so there is no build step in the loop.

To confirm the server is up:

```bash
curl http://localhost:9898
# Hacker chat server is running!
#
# Please connect with websocket protocol.
```

### With Docker

If you would rather not install Node.js locally, the Compose file builds a development image with the source bind-mounted, so `tsx watch` still reloads on save:

```bash
docker compose up          # build and run
docker compose up --build  # rebuild after a dependency change
docker compose down        # stop and clean up
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `9898` | TCP port the server listens on |
| `LOG_LEVEL` | `error` | Minimum log level: `debug`, `info`, `warning` or `error` |

Log levels, from most to least verbose:

- `debug` — every message as it passes through the server
- `info` — connections, joins and disconnections
- `warning` — unexpected events and recoverable issues
- `error` — failures only

Both variables can live in a `.env` file at the project root. The `dev` and `start` scripts load it through Node's `--env-file-if-exists` flag, and `.env.example` is there to copy from:

```env
PORT=9898
LOG_LEVEL=info
```

Values are validated with [Zod](https://zod.dev) while the config module is being evaluated, which happens before anything else in the process runs. An invalid value raises `InvalidEnvironmentError` listing the offending fields, and the server never reaches the point of accepting connections.

## WebSocket Protocol

Every message is a JSON object carried in a single WebSocket text frame:

```json
{ "event": "<event-name>", "message": <payload> }
```

Frames whose payload is not valid JSON, or that carry no `event` string, are logged and discarded. The connection stays open.

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `joinRoom` | `{ "userName": string, "roomId": string }` | Join a room, creating it if it does not exist yet |
| `message` | `string` | Send a chat message to the room the sender is currently in |

Sending `joinRoom` again on the same connection moves the user to another room: the server removes them from the old one, announces the departure there, and announces the arrival in the new one.

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `updateUsers` | `Array<{ id: string, userName: string }>` | The room roster, sent only to the user who just joined |
| `newUserConnected` | `{ id: string, userName: string }` | Broadcast to the room when someone joins |
| `message` | `{ userName: string, message: string }` | A chat message, broadcast to the whole room |
| `disconnectUser` | `{ id: string, userName: string }` | Broadcast to the room when someone leaves or disconnects |

Broadcasts reach every member of the room, the sender included. A client that echoes its own messages locally will otherwise show them twice.

### Example flow

```
client → server   {"event":"joinRoom","message":{"userName":"alice","roomId":"general"}}
server → client   {"event":"updateUsers","message":[{"id":"...","userName":"alice"}]}
server → room     {"event":"newUserConnected","message":{"id":"...","userName":"alice"}}

client → server   {"event":"message","message":"Hello, world!"}
server → room     {"event":"message","message":{"userName":"alice","message":"Hello, world!"}}
```

### HTTP endpoints

| Path | Response |
|---|---|
| `/healthz` | `200 OK` once the server is accepting connections |
| anything else | `200` with a plain-text notice pointing at the WebSocket protocol |

Both answers carry permissive CORS headers, so a browser client hosted anywhere can reach the server.

## Deploying

The server speaks plain HTTP, so put a reverse proxy (nginx, Caddy, Traefik) in front of it to terminate TLS and let clients connect over `wss://`.

### With Docker Compose

`compose.prod.yaml` builds the production image and runs it as a non-root user with a read-only filesystem, dropped capabilities and rotating logs:

```bash
docker compose -f compose.prod.yaml up -d --build
docker compose -f compose.prod.yaml logs -f
docker compose -f compose.prod.yaml down
```

The container is published on `127.0.0.1` only, which assumes a reverse proxy on the same host. Drop that prefix from the `ports` entry to expose it directly.

To run a prebuilt image instead of building on the host, set `IMAGE` and remove the `build` key:

```bash
IMAGE=ghcr.io/matheussartori/hackerchat-server:1.0.0 \
  docker compose -f compose.prod.yaml up -d
```

### Without Docker

On a Linux VPS (Ubuntu or Debian, though any cloud instance works the same way):

**1. Install Node.js**

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version  # v24.x.x or newer
```

**2. Clone and build**

```bash
git clone https://github.com/matheussartori/hackerchat-server.git
cd hackerchat-server
npm ci
npm run build
```

**3. Keep the process alive with PM2**

```bash
npm install -g pm2
PORT=9898 pm2 start dist/index.js --name hackerchat
pm2 save
pm2 startup  # then follow the printed instruction to enable autostart
```

**4. Open the port**

```bash
sudo ufw allow 9898/tcp
sudo ufw reload
```

Behind a cloud provider's security group (AWS, GCP, Azure), add the matching inbound rule for TCP `9898` as well.

## Development

| Command | Description |
|---|---|
| `npm run dev` | Start the server with `tsx` and reload on change |
| `npm run build` | Compile TypeScript to `dist/` with `tsup` |
| `npm start` | Run the compiled build |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` | Lint `src` and `test` with ESLint |
| `npm run lint:fix` | Lint and apply the fixes it can |
| `npm run test:ci` | Run the test suite once |
| `npm run test:watch` | Run the tests in watch mode |
| `npm run test:coverage` | Run the tests and write a coverage report |

CI runs lint, typecheck, tests with coverage, the build and `npm audit` on Node 24 and 26.

## Related Projects

- [hackerchat-terminal-client](https://github.com/matheussartori/hackerchat-terminal-client) — Terminal client for Hackerchat Server
- [hackerchat-js-sdk](https://github.com/matheussartori/hackerchat-js-sdk) — JavaScript/TypeScript SDK with a framework-agnostic client and React bindings

## License

[MIT](./LICENSE) © [Matheus Sartori](https://github.com/matheussartori)
