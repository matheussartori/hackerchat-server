import http from 'node:http'
import { randomUUID, createHash } from 'node:crypto'
import { createLogger } from '../logger/logger.js'
import type { ISocketServer, SocketServerSettings } from '../types/server.js'

const log = createLogger('SocketServer')

type ConnectedSocket = NodeJS.Socket & { id: string }

export class SocketServer implements ISocketServer {
  readonly port: number

  constructor({ port }: SocketServerSettings) {
    this.port = port
  }

  async sendMessage(socket: NodeJS.Socket, event: string, message: unknown): Promise<void> {
    socket.write(`${JSON.stringify({ event, message })}\n`)
  }

  async start(onConnection: (socket: ConnectedSocket) => void): Promise<http.Server> {
    const server = http.createServer((_req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Request-Method', '*')
      res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET')
      res.setHeader('Access-Control-Allow-Headers', '*')
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('Hacker chat server is running!\n\nPlease connect with websocket protocol.')
    })

    server.on('upgrade', (req, socket: NodeJS.Socket & { id?: string }) => {
      const key = req.headers['sec-websocket-key'] as string
      const acceptKey = createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64')

      socket.id = randomUUID()
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: WebSocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
        '\r\n'
      )
      onConnection(socket as ConnectedSocket)
    })

    return new Promise((resolve, reject) => {
      server.on('error', reject)
      server.listen(this.port, () => {
        log.info(`Running at port ${this.port}`)
        resolve(server)
      })
    })
  }
}
