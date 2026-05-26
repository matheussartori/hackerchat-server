import { ChatRoom } from './ChatRoom.js'
import { Events } from '../events/Events.js'
import { createLogger } from '../logger/logger.js'
import type { ChatUser, JoinRoomPayload } from '../types/chat.js'
import type { ISocketServer } from '../types/server.js'

const log = createLogger('ChatService')

export class ChatService {
  private readonly users = new Map<string, ChatUser>()
  private readonly rooms = new Map<string, ChatRoom>()

  constructor(private readonly server: ISocketServer) {}

  registerConnection(id: string, socket: NodeJS.Socket): void {
    log.info('Connection established with', id)
    this.users.set(id, { id, socket, userName: '', roomId: '' })
  }

  async joinRoom(socketId: string, payload: JoinRoomPayload): Promise<void> {
    const user = this.users.get(socketId)
    if (user === undefined) return

    const { userName, roomId } = payload
    const updatedUser: ChatUser = { ...user, userName, roomId }
    this.users.set(socketId, updatedUser)

    log.info(`${userName} joined room [${roomId}]`)

    const room = this.getOrCreateRoom(roomId)
    room.addUser(updatedUser)

    const currentUsers = room.getUsers().map(({ id, userName: name }) => ({ id, userName: name }))
    await this.server.sendMessage(updatedUser.socket, Events.UPDATE_USERS, currentUsers)

    this.broadcast({
      roomId,
      event: Events.NEW_USER_CONNECTED,
      message: { id: socketId, userName },
    })
  }

  broadcastMessage(socketId: string, message: string): void {
    const user = this.users.get(socketId)
    if (user === undefined || !user.roomId) return

    this.broadcast({
      roomId: user.roomId,
      event: Events.MESSAGE,
      message: { userName: user.userName, message },
    })
  }

  disconnectUser(socketId: string): void {
    const user = this.users.get(socketId)
    if (user === undefined) return

    const { userName, roomId } = user
    log.info(userName || socketId, 'disconnected')

    this.users.delete(socketId)

    if (!roomId) return

    const room = this.rooms.get(roomId)
    room?.removeUser(socketId)

    this.broadcast({
      roomId,
      event: Events.DISCONNECT_USER,
      message: { id: socketId, userName },
    })
  }

  private broadcast({
    roomId,
    event,
    message,
    excludeSocketId,
  }: {
    roomId: string
    event: string
    message: unknown
    excludeSocketId?: string
  }): void {
    const room = this.rooms.get(roomId)
    if (room === undefined) return

    for (const user of room.getUsers()) {
      if (excludeSocketId !== undefined && user.id === excludeSocketId) continue
      void this.server.sendMessage(user.socket, event, message)
    }
  }

  private getOrCreateRoom(roomId: string): ChatRoom {
    const existing = this.rooms.get(roomId)
    if (existing !== undefined) return existing

    const room = new ChatRoom(roomId)
    this.rooms.set(roomId, room)
    return room
  }
}
