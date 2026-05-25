import { EventTypes } from '../events/Events.js'
import type * as Types from '../@types/controllers/SocketControllerTypes.js'
import { type SocketMessage } from '../@types/server/SocketServerTypes.js'
import pc from 'picocolors'

const log = (...text: unknown[]): void => { console.log(pc.green('[Socket Controller]'), ...text) }
const error = (...text: unknown[]): void => { console.error(pc.yellow('[Socket Controller]'), ...text) }

export default class Controller {
  public socketServer

  private readonly users = new Map()
  private readonly rooms = new Map()

  constructor ({ socketServer }: Types.SocketServerInstance) {
    this.socketServer = socketServer
  }

  onConnectionCreated (socket: NodeJS.Socket & { id: string }): void {
    const { id } = socket
    log('Connection stablished with', id)
    const userData = { id, socket }
    this.updateGlobalUserData(id, userData)

    socket.on('data', this.onSocketData(id))
    socket.on('error', this.onSocketClosed(id))
    socket.on('end', this.onSocketClosed(id))
  }

  async joinRoom (socketId: string, data: Types.User): Promise<void> {
    const userData = data
    log(`${userData.userName} joined [${socketId}]`)
    const { roomId } = userData
    const user = this.updateGlobalUserData(socketId, userData)
    const users = this.joinUserOnRoom(String(roomId), user)
    const currentUsers = Array.from(users.values()).map(({ id, userName }) => ({
      userName,
      id
    })) as SocketMessage

    void this.socketServer.sendMessage(
      user.socket,
      EventTypes.event.UPDATE_USERS,
      currentUsers
    )

    this.broadcast({
      socketId,
      roomId: String(roomId),
      event: EventTypes.event.NEW_USER_CONNECTED,
      message: { id: socketId, userName: userData.userName },
      includeCurrentSocket: true
    })
  }

  broadcast ({
    socketId,
    roomId,
    event,
    message,
    includeCurrentSocket = false
  }: Types.Broadcast): void {
    const usersOnRoom = this.rooms.get(roomId)

    for (const [key, user] of usersOnRoom) {
      if (!includeCurrentSocket && key === socketId) continue
      void this.socketServer.sendMessage(user.socket as NodeJS.Socket, event, message)
    }
  }

  message (socketId: string, message: string): void {
    const { userName, roomId } = this.users.get(socketId)

    this.broadcast({
      roomId,
      socketId,
      event: EventTypes.event.MESSAGE,
      message: { userName, message },
      includeCurrentSocket: true
    })
  }

  private joinUserOnRoom (roomId: string, user: Types.User): [] {
    const usersOnRoom = this.rooms.get(roomId) ?? new Map()
    usersOnRoom.set(user.id, user)
    this.rooms.set(roomId, usersOnRoom)

    return usersOnRoom
  }

  private onSocketData (id: string): (data: string) => void {
    return (data: string) => {
      try {
        const { event, message } = JSON.parse(data) as { event: string, message: unknown };
        (this as unknown as Record<string, (id: string, msg: unknown) => void>)[event](id, message)
      } catch {
        error('Wrong event format.', data.toString())
      }
    }
  }

  private logoutUser (id: string, roomId: string): void {
    this.users.delete(id)
    const usersOnRoom = this.rooms.get(roomId)
    usersOnRoom.delete(id)

    this.rooms.set(roomId, usersOnRoom)
  }

  private onSocketClosed (id: string): () => void {
    return () => {
      const { userName, roomId } = this.users.get(id)
      log(userName, 'disconnected', id)
      this.logoutUser(id, roomId as string)

      this.broadcast({
        socketId: id,
        roomId,
        message: { id, userName },
        event: EventTypes.event.DISCONNECT_USER
      })
    }
  }

  private updateGlobalUserData (
    socketId: string,
    userData: Types.User
  ): Types.User {
    const users = this.users
    const user = users.get(socketId) ?? {}

    const updatedUserData = {
      ...user,
      ...userData
    }

    users.set(socketId, updatedUserData)

    return users.get(socketId)
  }
}
