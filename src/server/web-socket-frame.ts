/**
 * Minimal RFC 6455 framing: the encoders the server needs plus a stateful
 * decoder that turns a stream of TCP chunks into whole WebSocket frames.
 */

export const OPCODE = {
  CONTINUATION: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
} as const

/**
 * Largest message the server will buffer. A frame header may declare a length
 * up to 2^64, so without a cap a single client could exhaust memory before a
 * byte of payload arrives.
 */
export const MAX_PAYLOAD_BYTES = 1024 * 1024

export type DecodedFrame =
  | { type: 'text'; data: string }
  | { type: 'binary'; payload: Buffer }
  | { type: 'ping'; payload: Buffer }
  | { type: 'pong'; payload: Buffer }
  | { type: 'close'; payload: Buffer }

export class FrameTooLargeError extends Error {
  constructor(readonly declaredLength: number) {
    super(`Frame of ${declaredLength} bytes exceeds the ${MAX_PAYLOAD_BYTES} byte limit`)
    this.name = 'FrameTooLargeError'
  }
}

/** Servers must not mask; clients always must. */
function buildHeader(opcode: number, length: number): Buffer {
  if (length < 126) {
    return Buffer.from([0x80 | opcode, length])
  }
  if (length < 65536) {
    const header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(length, 2)
    return header
  }
  const header = Buffer.alloc(10)
  header[0] = 0x80 | opcode
  header[1] = 127
  header.writeBigUInt64BE(BigInt(length), 2)
  return header
}

export function encodeTextFrame(data: string): Buffer {
  const payload = Buffer.from(data, 'utf8')
  return Buffer.concat([buildHeader(OPCODE.TEXT, payload.length), payload])
}

/** Control frames carry at most 125 bytes and are never fragmented. */
export function encodeControlFrame(opcode: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const body = payload.length > 125 ? payload.subarray(0, 125) : payload
  return Buffer.concat([Buffer.from([0x80 | opcode, body.length]), body])
}

/** A close frame whose payload is the status code followed by a UTF-8 reason. */
export function encodeCloseFrame(code = 1000, reason = ''): Buffer {
  const reasonBytes = Buffer.from(reason, 'utf8')
  const payload = Buffer.alloc(2 + reasonBytes.length)
  payload.writeUInt16BE(code, 0)
  reasonBytes.copy(payload, 2)
  return encodeControlFrame(OPCODE.CLOSE, payload)
}

/**
 * Accumulates TCP chunks and yields every complete frame they contain.
 *
 * One instance per connection: a chunk may hold several frames, one frame may
 * span several chunks, and a message may be split across a text frame plus
 * continuation frames. All three are reassembled here.
 */
export class WebSocketFrameDecoder {
  private buffer: Buffer = Buffer.alloc(0)
  /** Payloads of an in-progress fragmented message, awaiting its FIN frame. */
  private fragments: Buffer[] = []
  private fragmentOpcode: number | null = null
  private fragmentBytes = 0

  /**
   * @throws {FrameTooLargeError} when a client declares a payload past
   * {@link MAX_PAYLOAD_BYTES}. The caller should close the connection: the
   * decoder cannot resynchronise once it refuses to buffer a frame.
   */
  decode(chunk: Buffer): DecodedFrame[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    const frames: DecodedFrame[] = []

    while (this.buffer.length >= 2) {
      const first = this.buffer[0]!
      const second = this.buffer[1]!
      const fin = (first & 0x80) !== 0
      const opcode = first & 0x0f
      const masked = (second & 0x80) !== 0

      let payloadLen = second & 0x7f
      let headerLen = 2

      if (payloadLen === 126) {
        if (this.buffer.length < 4) break
        payloadLen = this.buffer.readUInt16BE(2)
        headerLen = 4
      } else if (payloadLen === 127) {
        if (this.buffer.length < 10) break
        const declared = this.buffer.readBigUInt64BE(2)
        if (declared > BigInt(MAX_PAYLOAD_BYTES)) throw new FrameTooLargeError(Number(declared))
        payloadLen = Number(declared)
        headerLen = 10
      }

      if (payloadLen > MAX_PAYLOAD_BYTES) throw new FrameTooLargeError(payloadLen)
      if (masked) headerLen += 4

      // Wait for the rest of the frame rather than decoding a partial payload.
      if (this.buffer.length < headerLen + payloadLen) break

      let payload = Buffer.from(this.buffer.subarray(headerLen, headerLen + payloadLen))
      if (masked) {
        const mask = this.buffer.subarray(headerLen - 4, headerLen)
        for (let i = 0; i < payload.length; i++) {
          payload[i] = payload[i]! ^ mask[i % 4]!
        }
      }

      this.buffer = this.buffer.subarray(headerLen + payloadLen)

      // Control frames may be interleaved inside a fragmented message, so they
      // are dispatched without touching the fragment buffer.
      if (opcode === OPCODE.CLOSE) { frames.push({ type: 'close', payload }); continue }
      if (opcode === OPCODE.PING) { frames.push({ type: 'ping', payload }); continue }
      if (opcode === OPCODE.PONG) { frames.push({ type: 'pong', payload }); continue }

      if (opcode === OPCODE.CONTINUATION) {
        if (this.fragmentOpcode === null) continue // stray continuation, ignore
        this.fragmentBytes += payload.length
        if (this.fragmentBytes > MAX_PAYLOAD_BYTES) throw new FrameTooLargeError(this.fragmentBytes)
        this.fragments.push(payload)
        if (!fin) continue
        payload = Buffer.concat(this.fragments)
        const startedAs = this.fragmentOpcode
        this.resetFragments()
        frames.push(startedAs === OPCODE.BINARY
          ? { type: 'binary', payload }
          : { type: 'text', data: payload.toString('utf8') })
        continue
      }

      if (opcode !== OPCODE.TEXT && opcode !== OPCODE.BINARY) continue // reserved

      if (!fin) {
        this.fragmentOpcode = opcode
        this.fragments = [payload]
        this.fragmentBytes = payload.length
        continue
      }

      frames.push(opcode === OPCODE.BINARY
        ? { type: 'binary', payload }
        : { type: 'text', data: payload.toString('utf8') })
    }

    return frames
  }

  private resetFragments(): void {
    this.fragments = []
    this.fragmentOpcode = null
    this.fragmentBytes = 0
  }

  /** Bytes held back waiting for the rest of a frame. Exposed for tests. */
  get pendingBytes(): number {
    return this.buffer.length
  }
}

/** Read the status code from a close frame payload, if it carries one. */
export function closeCode(payload: Buffer): number | undefined {
  return payload.length >= 2 ? payload.readUInt16BE(0) : undefined
}
