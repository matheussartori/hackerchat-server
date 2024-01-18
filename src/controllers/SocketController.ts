import { EventTypes } from '../events/Events'
import type * as Types from '../@types/controllers/SocketControllerTypes'
import { type SocketMessage } from '../@types/server/SocketServerTypes'

export default class Controller {
  public socketServer

  private readonly users = new Map()
  private readonly rooms = new Map()

  /**
   * Controller constructor.
   *
   * @param {{ socketServer: string }} params
   */
  constructor ({ socketServer }: Types.SocketServerInstance) {
    this.socketServer = socketServer
  }

  /**
   * On connection created event handler.
   *
   * @param {Http.Server} socket
   */
  onConnectionCreated (socket: NodeJS.Socket & { id: string }): void {
    const { id } = socket
    console.log('Connection stablished with ', id)
    const userData = { id, socket }
    this.updateGlobalUserData(id, userData)

    socket.on('data', this.onSocketData(id))
    socket.on('error', this.onSocketClosed(id))
    socket.on('end', this.onSocketClosed(id))
  }

  /**
   * Handles the join room event.
   *
   * @param {string} socketId
   * @param {Types.User} data
   * @returns {Promise<void>}
   */
  async joinRoom (socketId: string, data: Types.User): Promise<void> {
    const userData = data
    console.log(`${userData.userName} joined! [${socketId}]`)
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

  /**
   * Send the message to all users/sockets.
   *
   * @param {Types.Broadcast} broadcast
   */
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

  /**
   * Handle the message send event.
   *
   * @param {string} socketId
   * @param {string} message
   */
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

  /**
   * Updates the room with new users.
   *
   * @param {string} roomId
   * @param {object} user
   * @returns
   */
  private joinUserOnRoom (roomId: string, user: Types.User): [] {
    const usersOnRoom = this.rooms.get(roomId) ?? new Map()
    usersOnRoom.set(user.id, user)
    this.rooms.set(roomId, usersOnRoom)

    return usersOnRoom
  }

  /**
   * Socket data handler.
   *
   * @param {string} id
   * @returns {(data: string) => void}
   */
  private onSocketData (id: string): (data: string) => void {
    return (data: string) => {
      try {
        const { event, message } = JSON.parse(data);
        (this as any)[event](id, message)
      } catch (error) {
        console.error('Wrong event format.', data.toString())
      }
    }
  }

  /**
   * Logout the user from the specific room.
   *
   * @param {string} id
   * @param {string} roomId
   * @returns {void}
   */
  private logoutUser (id: string, roomId: string): void {
    this.users.delete(id)
    const usersOnRoom = this.rooms.get(roomId)
    usersOnRoom.delete(id)

    this.rooms.set(roomId, usersOnRoom)
  }

  /**
   * Handle the socket end.
   *
   * @param {string} id
   * @returns {(_: Promise<void>) => void}
   */
  private onSocketClosed (id: string): (_: Promise<void>) => void {
    return (_: Promise<void>) => {
      const { userName, roomId } = this.users.get(id)
      console.log(userName, 'disconnected', id)
      this.logoutUser(id, roomId as string)

      this.broadcast({
        socketId: id,
        roomId,
        message: { id, userName },
        event: EventTypes.event.DISCONNECT_USER
      })
    }
  }

  /**
   * Update the user data.
   *
   * @param {string} socketId
   * @param {Types.User} userData
   * @returns {Types.User} updatedUserData
   */
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
