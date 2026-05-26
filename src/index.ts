import { SocketServer } from './server/SocketServer.js'
import { ChatService } from './chat/ChatService.js'
import { MessageHandler } from './messaging/MessageHandler.js'
import { createLogger } from './logger/logger.js'

const log = createLogger('App')

const port = process.env.PORT !== undefined ? Number(process.env.PORT) : 9898

const socketServer = new SocketServer({ port })
const chatService = new ChatService(socketServer)
const messageHandler = new MessageHandler(chatService)

socketServer.start((socket) => {
  chatService.registerConnection(socket.id, socket)
  socket.on('data', (data) => { messageHandler.handle(socket.id, data) })
  socket.on('error', () => { chatService.disconnectUser(socket.id) })
  socket.on('end', () => { chatService.disconnectUser(socket.id) })
}).catch((err: unknown) => {
  log.error('Failed to start server:', err instanceof Error ? err : new Error(String(err)))
  process.exit(1)
})
