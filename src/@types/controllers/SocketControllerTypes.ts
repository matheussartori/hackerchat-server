import SocketServer from '../../server/SocketServer'
import * as SocketServerTypes from '../server/SocketServerTypes'

export type SocketServerInstance = {
  socketServer: SocketServer
}

export type Broadcast = {
  socketId: string
  roomId: string
  event: string
  message: SocketServerTypes.SocketMessage
  includeCurrentSocket?: boolean
}

export type User = {
  id: string,
  roomId?: string,
  userName?: string,
  socket: NodeJS.Socket
}