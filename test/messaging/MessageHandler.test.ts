import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MessageHandler } from '../../src/messaging/MessageHandler.js'
import type { ChatService } from '../../src/chat/ChatService.js'

function createMockChatService(): ChatService {
  return {
    registerConnection: vi.fn(),
    joinRoom: vi.fn().mockResolvedValue(undefined),
    broadcastMessage: vi.fn(),
    disconnectUser: vi.fn(),
  } as unknown as ChatService
}

describe('MessageHandler', () => {
  let chatService: ChatService
  let handler: MessageHandler

  beforeEach(() => {
    chatService = createMockChatService()
    handler = new MessageHandler(chatService)
  })

  it('routes joinRoom event to chatService.joinRoom', () => {
    handler.handle('s1', '{"event":"joinRoom","message":{"userName":"alice","roomId":"room1"}}')
    expect(chatService.joinRoom).toHaveBeenCalledWith('s1', { userName: 'alice', roomId: 'room1' })
  })

  it('routes message event to chatService.broadcastMessage', () => {
    handler.handle('s1', '{"event":"message","message":"hello world"}')
    expect(chatService.broadcastMessage).toHaveBeenCalledWith('s1', 'hello world')
  })

  it('accepts a Buffer as input', () => {
    handler.handle('s1', Buffer.from('{"event":"message","message":"from buffer"}'))
    expect(chatService.broadcastMessage).toHaveBeenCalledWith('s1', 'from buffer')
  })

  it('does not throw on invalid JSON', () => {
    expect(() => { handler.handle('s1', 'not json') }).not.toThrow()
    expect(chatService.joinRoom).not.toHaveBeenCalled()
    expect(chatService.broadcastMessage).not.toHaveBeenCalled()
  })

  it('does not throw on unknown event', () => {
    expect(() => { handler.handle('s1', '{"event":"unknownEvent","message":null}') }).not.toThrow()
    expect(chatService.joinRoom).not.toHaveBeenCalled()
    expect(chatService.broadcastMessage).not.toHaveBeenCalled()
  })

  it('does not throw when event field is missing', () => {
    expect(() => { handler.handle('s1', '{"message":"hello"}') }).not.toThrow()
  })
})
