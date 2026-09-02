import http from 'node:http'
import type net from 'node:net'
import { randomUUID, createHash } from 'node:crypto'
import { createLogger } from '../logger/logger.js'
import { encodeCloseFrame, encodeTextFrame } from './web-socket-frame.js'
import type { ISocketServer, SocketServerSettings } from '../types/server.js'

const log = createLogger('SocketServer')

export type ConnectedSocket = net.Socket & { id: string }

/**
 * Decode a single, complete WebSocket text frame.
 *
 * Kept for one-shot decoding of a buffer already known to hold exactly one
 * frame. A live connection must use `WebSocketFrameDecoder` instead: TCP does
 * not preserve frame boundaries, so a socket chunk may carry part of a frame
 * or several frames at once.
 */
export function decodeFrame(buffer: Buffer): string | null {
  if (buffer.length < 2) return null
  const isMasked = (buffer[1]! & 0x80) !== 0
  let payloadLen = buffer[1]! & 0x7f
  let offset = 2

  if (payloadLen === 126) {
    if (buffer.length < 4) return null
    payloadLen = buffer.readUInt16BE(offset)
    offset += 2
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null
    payloadLen = Number(buffer.readBigUInt64BE(offset))
    offset += 8
  }

  const maskKey = isMasked ? buffer.subarray(offset, offset + 4) : null
  if (isMasked) offset += 4

  if (buffer.length < offset + payloadLen) return null
  const payload = Buffer.from(buffer.subarray(offset, offset + payloadLen))

  if (maskKey) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] = payload[i]! ^ maskKey[i % 4]!
    }
  }

  return payload.toString('utf8')
}

export class SocketServer implements ISocketServer {
  readonly port: number

  /**
   * Upgraded sockets are detached from the http server's own connection
   * tracking, so `server.close()` cannot see them. Holding them here is what
   * lets shutdown finish instead of hanging until the process is killed.
   */
  private readonly sockets = new Set<ConnectedSocket>()

  constructor({ port }: SocketServerSettings) {
    this.port = port
  }

  /** Live WebSocket connections. */
  get connectionCount(): number {
    return this.sockets.size
  }

  async sendMessage(socket: NodeJS.Socket, event: string, message: unknown): Promise<void> {
    socket.write(encodeTextFrame(JSON.stringify({ event, message })))
  }

  /** Say goodbye politely, then hang up. */
  closeConnection(socket: NodeJS.Socket, code = 1000, reason = ''): void {
    socket.write(encodeCloseFrame(code, reason))
    socket.end()
  }

  /**
   * Close every live connection with a WebSocket close frame, then stop
   * accepting new ones. Resolves once the http server is fully shut down.
   */
  async shutdown(server: http.Server, code = 1001, reason = 'Server shutting down'): Promise<void> {
    for (const socket of this.sockets) {
      try {
        socket.write(encodeCloseFrame(code, reason))
        socket.end()
      } catch {
        // Socket already gone; nothing to close.
      }
    }

    // Clients that ignore the close frame must not hold shutdown open.
    const graceTimer = setTimeout(() => {
      for (const socket of this.sockets) socket.destroy()
    }, 2000)
    graceTimer.unref?.()

    await new Promise<void>(resolve => server.close(() => resolve()))
    clearTimeout(graceTimer)
  }

  async start(onConnection: (socket: ConnectedSocket) => void): Promise<http.Server> {
    const server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Request-Method', '*')
      res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET')
      res.setHeader('Access-Control-Allow-Headers', '*')
      if (req.url === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('OK\n')
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('Hacker chat server is running!\n\nPlease connect with websocket protocol.')
    })

    server.on('upgrade', (req, socket: net.Socket & { id?: string }) => {
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

      const connected = socket as ConnectedSocket
      this.sockets.add(connected)
      const forget = () => { this.sockets.delete(connected) }
      socket.on('close', forget)
      socket.on('error', forget)

      onConnection(connected)
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
