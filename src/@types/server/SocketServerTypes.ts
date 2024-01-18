export interface SocketServerSettings {
  port: number
}

export interface SocketSendMessage {
  socket: NodeJS.Socket
  event: string
  message: string
}

export interface SocketMessage {
  id?: string
  userName?: string
  message?: string
}
