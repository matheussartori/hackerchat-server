import { env } from './env.js'
import { SocketServer, decodeFrame } from './server/socket-server.js'
import { ChatService } from './chat/chat-service.js'
import { MessageHandler } from './messaging/message-handler.js'
import { createLogger } from './logger/logger.js'

const log = createLogger('App')

const socketServer = new SocketServer({ port: env.PORT })
const chatService = new ChatService(socketServer)
const messageHandler = new MessageHandler(chatService)

socketServer.start((socket) => {
  chatService.registerConnection(socket.id, socket)
  socket.on('data', (data) => {
    const text = decodeFrame(data)
    if (text === null) {
      log.warn('Could not decode WebSocket frame from', socket.id)
      return
    }
    messageHandler.handle(socket.id, text)
  })
  socket.on('error', () => { chatService.disconnectUser(socket.id) })
  socket.on('end', () => { chatService.disconnectUser(socket.id) })
}).then((server) => {
  process.on('SIGTERM', () => {
    log.info('SIGTERM received, shutting down gracefully')
    server.close(() => { process.exit(0) })
  })
}).catch((err: unknown) => {
  log.error('Failed to start server:', err instanceof Error ? err : new Error(String(err)))
  process.exit(1)
})
