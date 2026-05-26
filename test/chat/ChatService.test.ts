import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChatService } from '../../src/chat/ChatService.js'
import { Events } from '../../src/events/Events.js'
import { createMockSocket } from '../helpers.js'
import type { ISocketServer } from '../../src/types/server.js'

function createMockServer(): ISocketServer {
  return {
    sendMessage: vi.fn().mockResolvedValue(undefined),
  }
}

describe('ChatService', () => {
  let server: ISocketServer
  let service: ChatService

  beforeEach(() => {
    server = createMockServer()
    service = new ChatService(server)
  })

  describe('registerConnection', () => {
    it('registers a socket without throwing', () => {
      expect(() => {
        service.registerConnection('s1', createMockSocket())
      }).not.toThrow()
    })
  })

  describe('joinRoom', () => {
    it('sends UPDATE_USERS to the joining user with the full room list', async () => {
      const socket = createMockSocket()
      service.registerConnection('s1', socket)
      await service.joinRoom('s1', { userName: 'alice', roomId: 'room1' })

      expect(server.sendMessage).toHaveBeenCalledWith(
        socket,
        Events.UPDATE_USERS,
        expect.arrayContaining([expect.objectContaining({ userName: 'alice', id: 's1' })])
      )
    })

    it('broadcasts NEW_USER_CONNECTED to all users including the joiner', async () => {
      const socket1 = createMockSocket()
      const socket2 = createMockSocket()
      service.registerConnection('s1', socket1)
      service.registerConnection('s2', socket2)
      await service.joinRoom('s1', { userName: 'alice', roomId: 'room1' })

      vi.clearAllMocks()
      await service.joinRoom('s2', { userName: 'bob', roomId: 'room1' })

      expect(server.sendMessage).toHaveBeenCalledWith(
        socket1,
        Events.NEW_USER_CONNECTED,
        expect.objectContaining({ userName: 'bob', id: 's2' })
      )
      expect(server.sendMessage).toHaveBeenCalledWith(
        socket2,
        Events.NEW_USER_CONNECTED,
        expect.objectContaining({ userName: 'bob', id: 's2' })
      )
    })

    it('does nothing when the socket id is not registered', async () => {
      await service.joinRoom('unknown', { userName: 'ghost', roomId: 'room1' })
      expect(server.sendMessage).not.toHaveBeenCalled()
    })

    it('sends the correct user list when multiple users are in the room', async () => {
      const socket1 = createMockSocket()
      const socket2 = createMockSocket()
      service.registerConnection('s1', socket1)
      service.registerConnection('s2', socket2)
      await service.joinRoom('s1', { userName: 'alice', roomId: 'room1' })
      await service.joinRoom('s2', { userName: 'bob', roomId: 'room1' })

      expect(server.sendMessage).toHaveBeenCalledWith(
        socket2,
        Events.UPDATE_USERS,
        expect.arrayContaining([
          expect.objectContaining({ userName: 'alice' }),
          expect.objectContaining({ userName: 'bob' }),
        ])
      )
    })
  })

  describe('broadcastMessage', () => {
    it('sends the message to all users in the room including the sender', async () => {
      const socket1 = createMockSocket()
      const socket2 = createMockSocket()
      service.registerConnection('s1', socket1)
      service.registerConnection('s2', socket2)
      await service.joinRoom('s1', { userName: 'alice', roomId: 'room1' })
      await service.joinRoom('s2', { userName: 'bob', roomId: 'room1' })

      vi.clearAllMocks()
      service.broadcastMessage('s1', 'hello')

      expect(server.sendMessage).toHaveBeenCalledWith(
        socket1,
        Events.MESSAGE,
        expect.objectContaining({ message: 'hello', userName: 'alice' })
      )
      expect(server.sendMessage).toHaveBeenCalledWith(
        socket2,
        Events.MESSAGE,
        expect.objectContaining({ message: 'hello', userName: 'alice' })
      )
    })

    it('does nothing for an unknown socket id', () => {
      service.broadcastMessage('unknown', 'hello')
      expect(server.sendMessage).not.toHaveBeenCalled()
    })

    it('does nothing when the user has not joined a room', () => {
      service.registerConnection('s1', createMockSocket())
      service.broadcastMessage('s1', 'hello')
      expect(server.sendMessage).not.toHaveBeenCalled()
    })

    it('does not leak messages to users in a different room', async () => {
      const socket1 = createMockSocket()
      const socket2 = createMockSocket()
      service.registerConnection('s1', socket1)
      service.registerConnection('s2', socket2)
      await service.joinRoom('s1', { userName: 'alice', roomId: 'room1' })
      await service.joinRoom('s2', { userName: 'bob', roomId: 'room2' })

      vi.clearAllMocks()
      service.broadcastMessage('s1', 'secret')

      expect(server.sendMessage).not.toHaveBeenCalledWith(
        socket2,
        Events.MESSAGE,
        expect.anything()
      )
    })
  })

  describe('disconnectUser', () => {
    it('broadcasts DISCONNECT_USER to remaining room members', async () => {
      const socket1 = createMockSocket()
      const socket2 = createMockSocket()
      service.registerConnection('s1', socket1)
      service.registerConnection('s2', socket2)
      await service.joinRoom('s1', { userName: 'alice', roomId: 'room1' })
      await service.joinRoom('s2', { userName: 'bob', roomId: 'room1' })

      vi.clearAllMocks()
      service.disconnectUser('s1')

      expect(server.sendMessage).toHaveBeenCalledWith(
        socket2,
        Events.DISCONNECT_USER,
        expect.objectContaining({ userName: 'alice', id: 's1' })
      )
    })

    it('does not send DISCONNECT_USER to the disconnecting user', async () => {
      const socket1 = createMockSocket()
      const socket2 = createMockSocket()
      service.registerConnection('s1', socket1)
      service.registerConnection('s2', socket2)
      await service.joinRoom('s1', { userName: 'alice', roomId: 'room1' })
      await service.joinRoom('s2', { userName: 'bob', roomId: 'room1' })

      vi.clearAllMocks()
      service.disconnectUser('s1')

      const sentToSocket1 = vi.mocked(server.sendMessage).mock.calls.some(
        ([socket, event]) => socket === socket1 && event === Events.DISCONNECT_USER
      )
      expect(sentToSocket1).toBe(false)
    })

    it('does nothing for an unknown socket id', () => {
      service.disconnectUser('unknown')
      expect(server.sendMessage).not.toHaveBeenCalled()
    })

    it('does nothing when user has not joined a room', () => {
      service.registerConnection('s1', createMockSocket())
      service.disconnectUser('s1')
      expect(server.sendMessage).not.toHaveBeenCalled()
    })
  })
})
