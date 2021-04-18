export type SocketServerSettings = {
  port: number
}

export type SocketSendMessage = {
  socket: any
  event: string
  message: string
}

export type SocketMessage = {
  id?: string
  userName?: string
  message?: string
}