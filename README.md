<h1 align="center">Hackerchat Server</h1>

<p align="center">
  A lightweight, client-agnostic WebSocket chat server built with Node.js and TypeScript.
</p>

<p align="center">
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D24-brightgreen?logo=node.js&logoColor=white" alt="Node.js version" /></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-6-blue?logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License" /></a>
</p>

<p align="center">
  <a href="#overview">Overview</a> ·
  <a href="#features">Features</a> ·
  <a href="#prerequisites">Prerequisites</a> ·
  <a href="#running-locally">Running Locally</a> ·
  <a href="#deploying-a-server">Deploying a Server</a> ·
  <a href="#websocket-protocol">WebSocket Protocol</a> ·
  <a href="#related-projects">Related Projects</a>
</p>

---

## Overview

Hackerchat Server is an HTTP service that handles WebSocket upgrades, allowing users to create and join rooms to exchange messages in real time.

It is completely **client-agnostic** — any interface that speaks WebSockets can connect to it: web apps, mobile apps, desktop clients, or terminal clients. The server is responsible solely for backend communication and does not ship with a frontend.

## Features

- Room-based real-time messaging
- Multiple concurrent rooms and users
- JSON-framed message protocol
- Zero runtime dependencies beyond logging (`pino`)
- Structured logging via `pino`
- Full TypeScript source

## Prerequisites

- **Node.js** `>= 24`
- **npm** `>= 10`

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

The server starts on port **9898** by default. To use a different port, set the `PORT` environment variable:

```bash
PORT=3000 npm run dev
```

> The dev server uses `tsx` for on-the-fly TypeScript execution and restarts automatically on file changes.

**Other useful commands**

| Command | Description |
|---|---|
| `npm run build` | Compile TypeScript to `dist/` via `tsup` |
| `npm start` | Run the compiled build |
| `npm run test:ci` | Run tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint the source with ESLint |
| `npm run lint:fix` | Lint and auto-fix |

## Deploying a Server

The following steps describe how to deploy Hackerchat Server on a Linux VPS (Ubuntu/Debian). The same approach applies to any cloud instance (AWS EC2, DigitalOcean Droplet, etc.).

### 1. Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version  # should print v24.x.x or higher
```

### 2. Clone and build

```bash
git clone https://github.com/matheussartori/hackerchat-server.git
cd hackerchat-server
npm install
npm run build
```

### 3. Start the server

```bash
PORT=9898 npm start
```

To verify the server is running, open a browser or use `curl`:

```bash
curl http://your-server-ip:9898
# Hacker chat server is running!
# Please connect with websocket protocol.
```

### 4. Keep it running with a process manager

Install [PM2](https://pm2.keymetrics.io) to keep the process alive across crashes and reboots:

```bash
npm install -g pm2
PORT=9898 pm2 start dist/index.js --name hackerchat
pm2 save
pm2 startup  # follow the printed instruction to enable autostart
```

### 5. Open the firewall port

```bash
sudo ufw allow 9898/tcp
sudo ufw reload
```

> If you are behind a cloud provider's security group (AWS, GCP, Azure), also add an inbound rule for TCP port 9898.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `9898` | TCP port the server listens on |

You can place these in a `.env` file at the project root — the server loads it automatically via Node's `--env-file-if-exists` flag.

```env
PORT=9898
```

## WebSocket Protocol

All messages are newline-delimited JSON objects with the shape:

```json
{ "event": "<event-name>", "message": <payload> }
```

### Client → Server events

| Event | Payload | Description |
|---|---|---|
| `joinRoom` | `{ "userName": string, "roomId": string }` | Join or create a room |
| `message` | `string` | Broadcast a chat message to the current room |

### Server → Client events

| Event | Payload | Description |
|---|---|---|
| `updateUsers` | `Array<{ id: string, userName: string }>` | Full user list sent to a client on join |
| `newUserConnected` | `{ id: string, userName: string }` | Emitted to the room when a new user joins |
| `message` | `{ userName: string, message: string }` | A chat message from another user |
| `disconnectUser` | `{ id: string, userName: string }` | Emitted to the room when a user disconnects |

### Example flow

```
client → server   {"event":"joinRoom","message":{"userName":"alice","roomId":"general"}}
server → client   {"event":"updateUsers","message":[{"id":"...","userName":"alice"}]}
server → room     {"event":"newUserConnected","message":{"id":"...","userName":"alice"}}

client → server   {"event":"message","message":"Hello, world!"}
server → room     {"event":"message","message":{"userName":"alice","message":"Hello, world!"}}
```

## Related Projects

- [hackerchat-terminal-client](https://github.com/matheussartori/hackerchat-terminal-client) — A terminal-based client for Hackerchat Server

## License

[MIT](./LICENSE) © [Matheus Sartori](https://github.com/matheussartori)
