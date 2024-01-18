import type SocketServer from '../../server/SocketServer'
import type * as SocketServerTypes from '../server/SocketServerTypes'

export interface SocketServerInstance {
  socketServer: SocketServer
}

export interface Broadcast {
  socketId: string
  roomId: string
  event: string
  message: SocketServerTypes.SocketMessage
  includeCurrentSocket?: boolean
}

export interface User {
  id: string
  roomId?: string
  userName?: string
  socket: NodeJS.Socket
}
