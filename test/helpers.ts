import net from 'node:net'
import { randomBytes } from 'node:crypto'
import { vi } from 'vitest'

export function createMockSocket(): NodeJS.Socket {
  return {
    write: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
    end: vi.fn(),
  } as unknown as NodeJS.Socket
}

/**
 * Build a client-style (masked) WebSocket text frame, the shape the server
 * expects to receive.
 */
export function maskedFrame(text: string, maskKey = Buffer.from([0x01, 0x02, 0x03, 0x04])): Buffer {
  const payload = Buffer.from(text, 'utf8')
  const masked = Buffer.from(payload)
  for (let i = 0; i < masked.length; i++) masked[i] ^= maskKey[i % 4]!

  let header: Buffer
  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length])
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 0x80 | 126
    header.writeUInt16BE(payload.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x81
    header[1] = 0x80 | 127
    header.writeBigUInt64BE(BigInt(payload.length), 2)
  }
  return Buffer.concat([header, maskKey, masked])
}

/**
 * A raw TCP WebSocket client. Unlike the platform `WebSocket`, it exposes the
 * underlying socket, so a test can hang up cleanly (FIN) or abruptly (RST) and
 * exercise the server's disconnect handling.
 */
export class RawSocketClient {
  private constructor(private readonly socket: net.Socket) {}

  static async connect(port: number): Promise<RawSocketClient> {
    const socket = net.createConnection({ port, host: '127.0.0.1' })
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })

    const key = randomBytes(16).toString('base64')
    socket.write(
      'GET / HTTP/1.1\r\n' +
        `Host: 127.0.0.1:${port}\r\n` +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${key}\r\n` +
        'Sec-WebSocket-Version: 13\r\n' +
        '\r\n',
    )

    await new Promise<void>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        if (chunk.toString('latin1').includes('101 Switching Protocols')) {
          socket.off('data', onData)
          resolve()
        }
      }
      socket.on('data', onData)
      socket.once('error', reject)
    })

    return new RawSocketClient(socket)
  }

  send(event: string, message: unknown): void {
    this.socket.write(maskedFrame(JSON.stringify({ event, message })))
  }

  /** Close politely: sends FIN, so the server's socket emits `end`. */
  hangUp(): void {
    this.socket.end()
  }

  /** Close abruptly, as a dropped network would. */
  destroy(): void {
    this.socket.destroy()
  }

  /**
   * Send only a frame header declaring a payload far past the server's limit.
   * The server should refuse it without buffering anything.
   */
  sendOversizedHeader(declaredLength = 2 ** 40): void {
    const header = Buffer.alloc(10)
    header[0] = 0x81
    header[1] = 0x80 | 127
    header.writeBigUInt64BE(BigInt(declaredLength), 2)
    this.socket.write(Buffer.concat([header, Buffer.from([0, 0, 0, 0])]))
  }
}
