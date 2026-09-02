import { describe, it, expect, beforeEach } from 'vitest'
import {
  FrameTooLargeError,
  MAX_PAYLOAD_BYTES,
  OPCODE,
  WebSocketFrameDecoder,
  closeCode,
  encodeCloseFrame,
  encodeControlFrame,
  encodeTextFrame,
} from '../../src/server/web-socket-frame.js'
import { maskedFrame } from '../helpers.js'

/** A client-style masked frame with an arbitrary opcode and FIN bit. */
function clientFrame(opcode: number, payload: Buffer, fin = true): Buffer {
  const mask = Buffer.from([0x0a, 0x0b, 0x0c, 0x0d])
  const masked = Buffer.from(payload)
  for (let i = 0; i < masked.length; i++) masked[i] = masked[i]! ^ mask[i % 4]!

  let header: Buffer
  if (payload.length < 126) {
    header = Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | payload.length])
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4)
    header[0] = (fin ? 0x80 : 0) | opcode
    header[1] = 0x80 | 126
    header.writeUInt16BE(payload.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = (fin ? 0x80 : 0) | opcode
    header[1] = 0x80 | 127
    header.writeBigUInt64BE(BigInt(payload.length), 2)
  }
  return Buffer.concat([header, mask, masked])
}

const text = (s: string, fin = true) => clientFrame(OPCODE.TEXT, Buffer.from(s, 'utf8'), fin)
const cont = (s: string, fin = true) =>
  clientFrame(OPCODE.CONTINUATION, Buffer.from(s, 'utf8'), fin)

describe('encodeTextFrame', () => {
  it('sets FIN and the text opcode', () => {
    expect(encodeTextFrame('hi')[0]).toBe(0x81)
  })

  it('leaves server frames unmasked, as the spec requires', () => {
    expect(encodeTextFrame('hi')[1]! & 0x80).toBe(0)
  })

  it('uses a 7-bit length for short payloads', () => {
    expect(encodeTextFrame('hello')[1]).toBe(5)
  })

  it('uses the 16-bit extended length past 125 bytes', () => {
    const frame = encodeTextFrame('x'.repeat(500))
    expect(frame[1]).toBe(126)
    expect(frame.readUInt16BE(2)).toBe(500)
  })

  it('uses the 64-bit extended length past 65535 bytes', () => {
    const frame = encodeTextFrame('x'.repeat(70000))
    expect(frame[1]).toBe(127)
    expect(Number(frame.readBigUInt64BE(2))).toBe(70000)
  })

  it('measures length in bytes, not characters', () => {
    expect(encodeTextFrame('🚀')[1]).toBe(4)
  })
})

describe('encodeControlFrame', () => {
  it('sets FIN and the given opcode', () => {
    expect(encodeControlFrame(OPCODE.PONG)[0]).toBe(0x8a)
  })

  it('carries the payload back verbatim', () => {
    const frame = encodeControlFrame(OPCODE.PONG, Buffer.from('keepalive'))
    expect(frame.subarray(2).toString()).toBe('keepalive')
  })

  it('truncates a payload past the 125-byte control limit', () => {
    const frame = encodeControlFrame(OPCODE.PING, Buffer.alloc(200, 0x61))
    expect(frame[1]).toBe(125)
    expect(frame.length).toBe(127)
  })
})

describe('encodeCloseFrame', () => {
  it('puts the status code first', () => {
    expect(closeCode(encodeCloseFrame(1001, 'bye').subarray(2))).toBe(1001)
  })

  it('appends the reason as utf-8', () => {
    expect(encodeCloseFrame(1001, 'bye').subarray(4).toString()).toBe('bye')
  })

  it('defaults to a normal closure', () => {
    expect(closeCode(encodeCloseFrame().subarray(2))).toBe(1000)
  })
})

describe('closeCode', () => {
  it('reads the code from a payload that carries one', () => {
    const payload = Buffer.alloc(2)
    payload.writeUInt16BE(1009, 0)
    expect(closeCode(payload)).toBe(1009)
  })

  it('returns undefined for an empty close payload', () => {
    expect(closeCode(Buffer.alloc(0))).toBeUndefined()
  })
})

describe('WebSocketFrameDecoder', () => {
  let decoder: WebSocketFrameDecoder

  beforeEach(() => {
    decoder = new WebSocketFrameDecoder()
  })

  describe('single frames', () => {
    it('decodes a masked text frame', () => {
      expect(decoder.decode(text('hello'))).toEqual([{ type: 'text', data: 'hello' }])
    })

    it('decodes an unmasked text frame', () => {
      expect(decoder.decode(maskedFrame('hi'))).toEqual([{ type: 'text', data: 'hi' }])
    })

    it('decodes an empty payload', () => {
      expect(decoder.decode(text(''))).toEqual([{ type: 'text', data: '' }])
    })

    it('decodes a 16-bit extended-length payload', () => {
      const body = 'x'.repeat(500)
      expect(decoder.decode(text(body))).toEqual([{ type: 'text', data: body }])
    })

    it('decodes a 64-bit extended-length payload', () => {
      const body = 'y'.repeat(70000)
      expect(decoder.decode(text(body))).toEqual([{ type: 'text', data: body }])
    })

    it('round-trips multi-byte utf-8', () => {
      const body = 'olá 🚀 ünïcode'
      expect(decoder.decode(text(body))).toEqual([{ type: 'text', data: body }])
    })
  })

  describe('several frames per chunk', () => {
    it('yields both frames coalesced into one chunk', () => {
      const chunk = Buffer.concat([text('one'), text('two')])

      expect(decoder.decode(chunk)).toEqual([
        { type: 'text', data: 'one' },
        { type: 'text', data: 'two' },
      ])
    })

    it('yields many frames in order', () => {
      const chunk = Buffer.concat(['a', 'b', 'c', 'd'].map(s => text(s)))

      expect(decoder.decode(chunk).map(f => f.type === 'text' && f.data)).toEqual([
        'a', 'b', 'c', 'd',
      ])
    })

    it('keeps a trailing partial frame for the next chunk', () => {
      const whole = Buffer.concat([text('first'), text('second')])
      const split = whole.length - 3

      expect(decoder.decode(whole.subarray(0, split))).toEqual([{ type: 'text', data: 'first' }])
      expect(decoder.decode(whole.subarray(split))).toEqual([{ type: 'text', data: 'second' }])
    })

    it('mixes control and text frames in one chunk', () => {
      const chunk = Buffer.concat([
        clientFrame(OPCODE.PING, Buffer.from('p')),
        text('after ping'),
      ])

      expect(decoder.decode(chunk)).toEqual([
        { type: 'ping', payload: Buffer.from('p') },
        { type: 'text', data: 'after ping' },
      ])
    })
  })

  describe('frames split across chunks', () => {
    it('reassembles a frame delivered one byte at a time', () => {
      const frame = text('reassembled')
      const out = []
      for (const byte of frame) out.push(...decoder.decode(Buffer.from([byte])))

      expect(out).toEqual([{ type: 'text', data: 'reassembled' }])
    })

    it('yields nothing until the payload is complete', () => {
      const frame = text('waiting')

      expect(decoder.decode(frame.subarray(0, frame.length - 1))).toEqual([])
      expect(decoder.decode(frame.subarray(frame.length - 1))).toEqual([
        { type: 'text', data: 'waiting' },
      ])
    })

    it('waits for a truncated 16-bit length header', () => {
      const frame = text('x'.repeat(300))

      expect(decoder.decode(frame.subarray(0, 3))).toEqual([])
      expect(decoder.decode(frame.subarray(3))).toHaveLength(1)
    })

    it('waits for a truncated 64-bit length header', () => {
      const frame = text('x'.repeat(70000))

      expect(decoder.decode(frame.subarray(0, 6))).toEqual([])
      expect(decoder.decode(frame.subarray(6))).toHaveLength(1)
    })

    it('reassembles a payload larger than one TCP segment', () => {
      const body = 'z'.repeat(200_000)
      const frame = text(body)
      const out = []
      for (let i = 0; i < frame.length; i += 65536) {
        out.push(...decoder.decode(frame.subarray(i, i + 65536)))
      }

      expect(out).toEqual([{ type: 'text', data: body }])
    })

    it('reports how many bytes it is holding back', () => {
      const frame = text('partial')
      decoder.decode(frame.subarray(0, 4))

      expect(decoder.pendingBytes).toBe(4)
    })

    it('holds nothing once a frame completes', () => {
      decoder.decode(text('done'))

      expect(decoder.pendingBytes).toBe(0)
    })
  })

  describe('fragmented messages', () => {
    it('joins a text frame and its continuation', () => {
      const chunk = Buffer.concat([text('hello ', false), cont('world')])

      expect(decoder.decode(chunk)).toEqual([{ type: 'text', data: 'hello world' }])
    })

    it('joins several continuations', () => {
      const chunk = Buffer.concat([text('a', false), cont('b', false), cont('c')])

      expect(decoder.decode(chunk)).toEqual([{ type: 'text', data: 'abc' }])
    })

    it('emits nothing until the final fragment arrives', () => {
      expect(decoder.decode(text('half ', false))).toEqual([])
      expect(decoder.decode(cont('done'))).toEqual([{ type: 'text', data: 'half done' }])
    })

    it('passes a control frame through mid-message', () => {
      const chunk = Buffer.concat([
        text('start ', false),
        clientFrame(OPCODE.PING, Buffer.from('p')),
        cont('end'),
      ])

      expect(decoder.decode(chunk)).toEqual([
        { type: 'ping', payload: Buffer.from('p') },
        { type: 'text', data: 'start end' },
      ])
    })

    it('ignores a continuation with no message in progress', () => {
      expect(decoder.decode(cont('orphan'))).toEqual([])
    })

    it('starts a fresh message after a completed one', () => {
      decoder.decode(Buffer.concat([text('one ', false), cont('two')]))

      expect(decoder.decode(text('three'))).toEqual([{ type: 'text', data: 'three' }])
    })
  })

  describe('control frames', () => {
    it('decodes a ping with its payload unmasked', () => {
      expect(decoder.decode(clientFrame(OPCODE.PING, Buffer.from('keepalive')))).toEqual([
        { type: 'ping', payload: Buffer.from('keepalive') },
      ])
    })

    it('decodes a pong', () => {
      expect(decoder.decode(clientFrame(OPCODE.PONG, Buffer.alloc(0)))).toEqual([
        { type: 'pong', payload: Buffer.alloc(0) },
      ])
    })

    it('decodes a close frame and exposes its status code', () => {
      const payload = Buffer.alloc(2)
      payload.writeUInt16BE(1000, 0)
      const [frame] = decoder.decode(clientFrame(OPCODE.CLOSE, payload))

      expect(frame?.type).toBe('close')
      expect(closeCode((frame as { payload: Buffer }).payload)).toBe(1000)
    })

    it('decodes an empty close frame', () => {
      expect(decoder.decode(clientFrame(OPCODE.CLOSE, Buffer.alloc(0)))).toEqual([
        { type: 'close', payload: Buffer.alloc(0) },
      ])
    })

    it('unmasks a control payload, unlike a naive decoder', () => {
      const [frame] = decoder.decode(clientFrame(OPCODE.PING, Buffer.from('masked?')))

      expect((frame as { payload: Buffer }).payload.toString()).toBe('masked?')
    })
  })

  describe('binary and reserved opcodes', () => {
    it('surfaces a binary frame separately from text', () => {
      expect(decoder.decode(clientFrame(OPCODE.BINARY, Buffer.from([1, 2, 3])))).toEqual([
        { type: 'binary', payload: Buffer.from([1, 2, 3]) },
      ])
    })

    it('skips a reserved opcode without losing the next frame', () => {
      const chunk = Buffer.concat([clientFrame(0x3, Buffer.from('reserved')), text('kept')])

      expect(decoder.decode(chunk)).toEqual([{ type: 'text', data: 'kept' }])
    })
  })

  describe('oversized frames', () => {
    it('refuses a 16-bit length past the cap', () => {
      // Declare a huge payload without actually sending it.
      const header = Buffer.alloc(10)
      header[0] = 0x81
      header[1] = 127
      header.writeBigUInt64BE(BigInt(MAX_PAYLOAD_BYTES + 1), 2)

      expect(() => decoder.decode(header)).toThrow(FrameTooLargeError)
    })

    it('refuses before buffering the payload', () => {
      const header = Buffer.alloc(10)
      header[0] = 0x81
      header[1] = 127
      header.writeBigUInt64BE(2n ** 40n, 2)

      expect(() => decoder.decode(header)).toThrow(/exceeds/)
    })

    it('reports the declared length on the error', () => {
      const header = Buffer.alloc(10)
      header[0] = 0x81
      header[1] = 127
      header.writeBigUInt64BE(BigInt(MAX_PAYLOAD_BYTES * 4), 2)

      try {
        decoder.decode(header)
        expect.unreachable('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(FrameTooLargeError)
        expect((err as FrameTooLargeError).declaredLength).toBe(MAX_PAYLOAD_BYTES * 4)
      }
    })

    it('refuses a fragmented message that grows past the cap', () => {
      const big = 'x'.repeat(600_000)
      decoder.decode(text(big, false))

      expect(() => decoder.decode(cont(big))).toThrow(FrameTooLargeError)
    })

    it('accepts a frame exactly at the cap', () => {
      const body = 'x'.repeat(MAX_PAYLOAD_BYTES)

      expect(decoder.decode(text(body))).toEqual([{ type: 'text', data: body }])
    })
  })
})
