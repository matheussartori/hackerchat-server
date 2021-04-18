import { EventTypes } from '../events/Events'
import * as Types from '../@types/controllers/SocketControllerTypes'
import Http from 'http'

export default class Controller {
  public socketServer

  private users = new Map()
  private rooms = new Map()

  /**
   * Controller constructor.
   *
   * @param {{ socketServer: string }} params
   */
  constructor({ socketServer }: Types.SocketServerInstance) {
    this.socketServer = socketServer
  }

  /**
   * On connection created event handler.
   *
   * @param {Http.Server} socket
   */
  onConnectionCreated(socket: Http.Server) {
    // @ts-ignore
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
   */
  async joinRoom(socketId: string, data: Types.User) {
    const userData = data
    console.log(`${userData.userName} joined! ${[socketId]}`)
    const { roomId } = userData
    const user = this.updateGlobalUserData(socketId, userData)
    const users = this.joinUserOnRoom(String(roomId), user)
    // @ts-ignore
    const currentUsers = Array.from(users.values()).map(({ id, userName }) => ({
      userName,
      id
    }))

    await this.socketServer.sendMessage(
      user.socket,
      EventTypes.event.UPDATE_USERS,
      currentUsers
    )

    this.broadcast({
      socketId,
      roomId: String(roomId),
      message: { id: socketId, userName: userData.userName },
      event: EventTypes.event.NEW_USER_CONNECTED,
      includeCurrentSocket: true
    })
  }

  /**
   * Send the message to all users/sockets.
   *
   * @param {Types.Broadcast} broadcast
   */
  broadcast({
    socketId,
    roomId,
    event,
    message,
    includeCurrentSocket = false
  }: Types.Broadcast): void {
    const usersOnRoom = this.rooms.get(roomId)

    for (const [key, user] of usersOnRoom) {
      if (!includeCurrentSocket && key === socketId) continue

      this.socketServer.sendMessage(user.socket, event, message)
    }
  }

  /**
   * Handle the message send event.
   *
   * @param {string} socketId
   * @param {string} message
   */
  message(socketId: string, message: string): void {
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
  private joinUserOnRoom(roomId: string, user: Types.User): [] {
    const usersOnRoom = this.rooms.get(roomId) ?? new Map()
    usersOnRoom.set(user.id, user)
    this.rooms.set(roomId, usersOnRoom)

    return usersOnRoom
  }

  /**
   * Socket data handler.
   *
   * @param {string} id
   * @returns
   */
  private onSocketData(id: string) {
    return (data: string) => {
      try {
        const { event, message } = JSON.parse(data)
        // @ts-ignore
        this[event](id, message)
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
   */
  private logoutUser(id: string, roomId: string): void {
    this.users.delete(id)
    const usersOnRoom = this.rooms.get(roomId)
    usersOnRoom.delete(id)

    this.rooms.set(roomId, usersOnRoom)
  }

  /**
   * Handle the socket end.
   *
   * @param {string} id
   */
  private onSocketClosed(id: string) {
    return (_: Promise<void>) => {
      const { userName, roomId } = this.users.get(id)
      console.log(userName, 'disconnected', id)
      this.logoutUser(id, roomId)

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
  private updateGlobalUserData(socketId: string, userData: Types.User): Types.User {
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
