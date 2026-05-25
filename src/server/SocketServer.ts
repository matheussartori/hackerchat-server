import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { EventTypes } from '../events/Events.js'
import type * as Types from '../@types/server/SocketServerTypes.js'

export default class SocketServer {
  public port: number

  constructor ({ port }: Types.SocketServerSettings) {
    this.port = port
  }

  async sendMessage (
    socket: NodeJS.Socket,
    event: string,
    message: Types.SocketMessage
  ): Promise<void> {
    const data = JSON.stringify({ event, message })
    socket.write(`${data}\n`)
  }

  async initialize (eventEmitter: NodeJS.EventEmitter): Promise<http.Server> {
    const server = http.createServer((request: http.IncomingMessage, response: http.ServerResponse) => {
      response.setHeader('Access-Control-Allow-Origin', '*')
      response.setHeader('Access-Control-Request-Method', '*')
      response.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET')
      response.setHeader('Access-Control-Allow-Headers', '*')

      response.writeHead(200, { 'Content-Type': 'text/plain' })
      response.end('Hacker chat server is running!\n\nPlease connect with websocket protocol.')
    })

    server.on('upgrade', (request, socket: NodeJS.Socket & { id?: string }) => {
      socket.id = randomUUID()
      const headers = [
        'HTTP/1.1 101 Web Socket Protocol Handshake',
        'Upgrade: WebSocket',
        'Connection: Upgrade',
        ''
      ]
        .map(line => line.concat('\r\n'))
        .join('')

      socket.write(headers)
      eventEmitter.emit(EventTypes.event.NEW_USER_CONNECTED, socket)
    })

    return await new Promise((resolve, reject) => {
      server.on('error', reject)
      server.listen(this.port, () => { resolve(server) })
    })
  }
}
