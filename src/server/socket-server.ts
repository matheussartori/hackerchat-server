import http from 'node:http'
import { randomUUID, createHash } from 'node:crypto'
import { createLogger } from '../logger/logger.js'
import type { ISocketServer, SocketServerSettings } from '../types/server.js'

const log = createLogger('SocketServer')

type ConnectedSocket = NodeJS.Socket & { id: string }

function encodeFrame(data: string): Buffer {
  const payload = Buffer.from(data, 'utf8')
  const len = payload.length
  let header: Buffer
  if (len < 126) {
    header = Buffer.alloc(2)
    header[0] = 0x81 // FIN + text opcode
    header[1] = len
  } else if (len < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x81
    header[1] = 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  return Buffer.concat([header, payload])
}

export function decodeFrame(buffer: Buffer): string | null {
  if (buffer.length < 2) return null
  const isMasked = (buffer[1] & 0x80) !== 0
  let payloadLen = buffer[1] & 0x7f
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
      payload[i] ^= maskKey[i % 4]
    }
  }

  return payload.toString('utf8')
}

export class SocketServer implements ISocketServer {
  readonly port: number

  constructor({ port }: SocketServerSettings) {
    this.port = port
  }

  async sendMessage(socket: NodeJS.Socket, event: string, message: unknown): Promise<void> {
    socket.write(encodeFrame(JSON.stringify({ event, message })))
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
