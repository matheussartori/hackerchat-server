export interface ChatUser {
  id: string
  socket: NodeJS.Socket
  userName: string
  roomId: string
}

export interface JoinRoomPayload {
  userName: string
  roomId: string
}
