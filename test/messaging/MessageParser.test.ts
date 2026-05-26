import { describe, it, expect } from 'vitest'
import { parseMessage, MessageParseError } from '../../src/messaging/MessageParser.js'

describe('parseMessage', () => {
  it('parses a valid message with string payload', () => {
    const result = parseMessage('{"event":"message","message":"hello world"}')
    expect(result).toEqual({ event: 'message', message: 'hello world' })
  })

  it('parses a valid message with object payload', () => {
    const result = parseMessage('{"event":"joinRoom","message":{"userName":"alice","roomId":"room1"}}')
    expect(result).toEqual({
      event: 'joinRoom',
      message: { userName: 'alice', roomId: 'room1' },
    })
  })

  it('parses a message without a payload field', () => {
    const result = parseMessage('{"event":"joinRoom"}')
    expect(result).toEqual({ event: 'joinRoom', message: undefined })
  })

  it('throws MessageParseError on invalid JSON', () => {
    expect(() => parseMessage('not json')).toThrow(MessageParseError)
    expect(() => parseMessage('not json')).toThrow('Invalid JSON')
  })

  it('throws MessageParseError when event field is missing', () => {
    expect(() => parseMessage('{"message":"hello"}')).toThrow(MessageParseError)
    expect(() => parseMessage('{"message":"hello"}')).toThrow('Missing or invalid "event" field')
  })

  it('throws MessageParseError when event is not a string', () => {
    expect(() => parseMessage('{"event":42,"message":"hello"}')).toThrow(MessageParseError)
  })

  it('throws MessageParseError for null', () => {
    expect(() => parseMessage('null')).toThrow(MessageParseError)
  })

  it('throws MessageParseError for an array', () => {
    expect(() => parseMessage('["event","message"]')).toThrow(MessageParseError)
  })

  it('preserves the raw string on MessageParseError', () => {
    const raw = 'bad data'
    try {
      parseMessage(raw)
    } catch (err) {
      expect(err).toBeInstanceOf(MessageParseError)
      expect((err as MessageParseError).raw).toBe(raw)
    }
  })
})
