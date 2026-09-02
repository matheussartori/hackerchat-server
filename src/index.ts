import { env } from './env.js'
import { SocketServer } from './server/socket-server.js'
import {
  FrameTooLargeError,
  OPCODE,
  WebSocketFrameDecoder,
  closeCode,
  encodeControlFrame,
} from './server/web-socket-frame.js'
import { ChatService } from './chat/chat-service.js'
import { MessageHandler } from './messaging/message-handler.js'
import { createLogger } from './logger/logger.js'
import type { ConnectedSocket } from './server/socket-server.js'

const log = createLogger('App')

const socketServer = new SocketServer({ port: env.PORT })
const chatService = new ChatService(socketServer)
const messageHandler = new MessageHandler(chatService)

function handleConnection(socket: ConnectedSocket): void {
  chatService.registerConnection(socket.id, socket)

  // One decoder per connection: it holds the bytes of a frame that has not
  // fully arrived yet, so it must not be shared between sockets.
  const decoder = new WebSocketFrameDecoder()
  let disconnected = false

  const disconnect = (): void => {
    if (disconnected) return
    disconnected = true
    chatService.disconnectUser(socket.id)
  }

  socket.on('data', (data: Buffer) => {
    let frames
    try {
      frames = decoder.decode(data)
    } catch (err) {
      if (err instanceof FrameTooLargeError) {
        log.warn('Frame too large from', socket.id, '-', err.message)
        // 1009 = message too big. The decoder cannot resynchronise after
        // refusing a frame, so the connection has to go.
        socketServer.closeConnection(socket, 1009, 'Message too big')
      } else {
        log.error('Could not decode WebSocket frame from', socket.id, err)
        socketServer.closeConnection(socket, 1002, 'Protocol error')
      }
      disconnect()
      return
    }

    for (const frame of frames) {
      switch (frame.type) {
        case 'text':
          messageHandler.handle(socket.id, frame.data)
          break
        case 'ping':
          socket.write(encodeControlFrame(OPCODE.PONG, frame.payload))
          break
        case 'close':
          log.info('Close frame from', socket.id, `(code ${closeCode(frame.payload) ?? 'none'})`)
          socket.write(encodeControlFrame(OPCODE.CLOSE, frame.payload))
          socket.end()
          disconnect()
          return
        case 'pong':
        case 'binary':
          // The protocol carries nothing binary, and pongs need no reply.
          break
      }
    }
  })

  socket.on('error', disconnect)
  socket.on('end', disconnect)
  socket.on('close', disconnect)
}

const server = await socketServer.start(handleConnection).catch((err: unknown) => {
  log.error('Failed to start server:', err instanceof Error ? err : new Error(String(err)))
  process.exit(1)
})

let shuttingDown = false

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  log.info(`${signal} received, shutting down gracefully`)
  try {
    await socketServer.shutdown(server)
    process.exit(0)
  } catch (err: unknown) {
    log.error('Error during shutdown:', err instanceof Error ? err : new Error(String(err)))
    process.exit(1)
  }
}

process.on('SIGTERM', () => { void shutdown('SIGTERM') })
process.on('SIGINT', () => { void shutdown('SIGINT') })
