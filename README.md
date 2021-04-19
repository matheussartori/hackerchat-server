<p align="center">
  <img alt="Hackerchat Server" height="350" src="./assets/hackerchat.svg" />
</p>

<h3 align="center">
  Hackerchat Server
</h3>

<blockquote align="center">"This software is a continued idea of the project created by Erick Wendel."</blockquote>
<br>

<p align="center">
  <a href="https://redstonesolutions.com.br">
    <img alt="Made by Matheus Sartori" src="https://img.shields.io/badge/made%20by-Matheus%20Sartori-%2304D361">
  </a>

  <img alt="License" src="https://img.shields.io/badge/license-MIT-%2304D361">
</p>

<p align="center">
  <a href="#about-the-project">About the project</a>
  <a href="#installation">Installation</a>
  <a href="#starting-a-server">Starting a server</a>
</p>

## About the project

Hacker chat is a http service that works with websockets. It allows users to create and connect in rooms and change messages.

It is possible to create any interface to communicate with it, web, mobile, desktop, etc.

The socket is created without any third-party lib like <a href="https://socket.io/" target="_blank">Socket.io</a>, the only dependency is <a href="https://www.npmjs.com/package/uuid" target="_blank">uuid</a>, mainly for unique socket communications.

### Installation

To run the server, you need to install the node dependencies, and a node engine version 15 or above. To install the modules:

```
npm install
```

### Starting a server

To start a server, you can specify the port on the NODE_ENV PORT, for example, on linux:

```
PORT=3000 npm run start
```

Since this project uses <a href="https://www.typescriptlang.org/" target="_blank">TypeScript</a>, you need to run "npm run build" before "npm run start", or you can simply run "npm run dev" to run the project with <a href="https://www.npmjs.com/package/ts-node" target="_blank">ts-node</a> on the src folder.

---

Made with ❤️ by Redstone Solutions :wave: [Join our community!](https://discord.gg/SNQXH5cKEB)
