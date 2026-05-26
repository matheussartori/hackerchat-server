export interface SocketServerSettings {
  port: number
}

export interface ISocketServer {
  sendMessage(socket: NodeJS.Socket, event: string, message: unknown): Promise<void>
}
