import { ChatRoom } from './chat-room.js'
import { Events } from '../events/events.js'
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

    // Leaving the previous room first. Without this the old room keeps the user
    // in its roster forever and goes on delivering its messages to this socket.
    if (user.roomId !== '' && user.roomId !== roomId) {
      this.leaveRoom(user.roomId, socketId, user.userName)
    }

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

    this.leaveRoom(roomId, socketId, userName)
  }

  /**
   * Drop a user from a room, tell whoever is left, and forget the room once it
   * empties out so the room map does not grow without bound.
   */
  private leaveRoom(roomId: string, socketId: string, userName: string): void {
    const room = this.rooms.get(roomId)
    if (room === undefined) return

    if (!room.removeUser(socketId)) return

    this.broadcast({
      roomId,
      event: Events.DISCONNECT_USER,
      message: { id: socketId, userName },
    })

    if (room.isEmpty()) {
      this.rooms.delete(roomId)
    }
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
