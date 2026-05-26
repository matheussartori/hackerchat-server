import { parseMessage, MessageParseError } from './MessageParser.js'
import { Events } from '../events/Events.js'
import { createLogger } from '../logger/logger.js'
import type { ChatService } from '../chat/ChatService.js'
import type { JoinRoomPayload } from '../types/chat.js'

const log = createLogger('MessageHandler')

export class MessageHandler {
  constructor(private readonly chatService: ChatService) {}

  handle(socketId: string, raw: Buffer | string): void {
    const rawStr = raw.toString()
    log.debug(`Raw message from ${socketId}:`, rawStr)
    try {
      const { event, message } = parseMessage(rawStr)
      log.debug(`Routing event "${event}" from ${socketId}`)
      this.route(socketId, event, message)
    } catch (err) {
      if (err instanceof MessageParseError) {
        log.error('Invalid message format:', err.raw)
      } else {
        log.error('Unexpected error:', err)
      }
    }
  }

  private route(socketId: string, event: string, message: unknown): void {
    switch (event) {
      case Events.JOIN_ROOM:
        void this.chatService.joinRoom(socketId, message as JoinRoomPayload)
        break
      case Events.MESSAGE:
        this.chatService.broadcastMessage(socketId, message as string)
        break
      default:
        log.warn('Unknown event:', event)
    }
  }
}
