import http from 'http'
import { randomUUID } from 'node:crypto'
import { EventTypes } from '../events/Events'
import type * as Types from '../@types/server/SocketServerTypes'

export default class SocketServer {
  public port: number

  /**
   * Socket server constructor.
   *
   * @param {Types.SocketServerSettings} SocketServerSettings
   */
  constructor ({ port }: Types.SocketServerSettings) {
    this.port = port
  }

  /**
   * Write the message on the socket.
   *
   * @param {NodeJS.Socket} socket
   * @param {string} event
   * @param {Types.SocketMessage} message
   * @returns {Promise<void>} promise
   */
  async sendMessage (
    socket: NodeJS.Socket,
    event: string,
    message: Types.SocketMessage
  ): Promise<void> {
    const data = JSON.stringify({ event, message })
    socket.write(`${data}\n`)
  }

  /**
   * Initialize the socket server.
   *
   * @param {NodeJS.EventEmitter} eventEmitter
   * @returns {Promise<http.Server>} server
   */
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
