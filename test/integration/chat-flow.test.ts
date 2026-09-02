import { describe, it, expect, afterEach } from 'vitest'
import type net from 'node:net'
import type { AddressInfo } from 'node:net'
import { SocketServer } from '../../src/server/socket-server.js'
import {
  FrameTooLargeError,
  OPCODE,
  WebSocketFrameDecoder,
  encodeControlFrame,
} from '../../src/server/web-socket-frame.js'
import { ChatService } from '../../src/chat/chat-service.js'
import { MessageHandler } from '../../src/messaging/message-handler.js'
import { Events } from '../../src/events/events.js'
import { RawSocketClient } from '../helpers.js'

interface Frame {
  event: string
  message: unknown
}

/**
 * A real client over a real socket: opens a browser-grade WebSocket against
 * the running server and buffers every frame it receives.
 */
class TestClient {
  private readonly ws: WebSocket
  private readonly received: Frame[] = []
  private readonly waiters: { predicate: (f: Frame) => boolean; resolve: (f: Frame) => void }[] = []

  private constructor(ws: WebSocket) {
    this.ws = ws
    this.ws.addEventListener('message', event => {
      const frame = JSON.parse(event.data as string) as Frame
      const waiter = this.waiters.find(w => w.predicate(frame))
      if (waiter) {
        // Handed straight to whoever was waiting, so it must not also stay in
        // the buffer where a later `next()` could return it a second time.
        this.waiters.splice(this.waiters.indexOf(waiter), 1)
        waiter.resolve(frame)
        return
      }
      this.received.push(frame)
    })
  }

  static async connect(port: number): Promise<TestClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    return new TestClient(ws)
  }

  send(event: string, message: unknown): void {
    this.ws.send(JSON.stringify({ event, message }))
  }

  /** Send an arbitrary payload, bypassing frame construction. */
  sendRaw(payload: string): void {
    this.ws.send(payload)
  }

  join(userName: string, roomId: string): void {
    this.send(Events.JOIN_ROOM, { userName, roomId })
  }

  /**
   * Resolve with the next (or already-buffered) frame for `event`. `match`
   * narrows further, which matters because the server echoes some events back
   * to the client that caused them.
   */
  async next(
    event: string,
    match: (message: never) => boolean = () => true,
    timeoutMs = 2000,
  ): Promise<Frame> {
    const predicate = (f: Frame) => f.event === event && match(f.message as never)

    const buffered = this.received.find(predicate)
    if (buffered) {
      this.received.splice(this.received.indexOf(buffered), 1)
      return buffered
    }
    return new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for "${event}"`)),
        timeoutMs,
      )
      this.waiters.push({
        predicate,
        resolve: frame => {
          clearTimeout(timer)
          resolve(frame)
        },
      })
    })
  }

  get frames(): readonly Frame[] {
    return this.received
  }

  close(): void {
    this.ws.close()
  }
}

/** Wire up the production stack the same way `src/index.ts` does. */
async function startStack() {
  const socketServer = new SocketServer({ port: 0 })
  const chatService = new ChatService(socketServer)
  const messageHandler = new MessageHandler(chatService)
  const rawSockets: net.Socket[] = []

  const httpServer = await socketServer.start(socket => {
    rawSockets.push(socket)
    chatService.registerConnection(socket.id, socket)

    const decoder = new WebSocketFrameDecoder()
    let disconnected = false
    const disconnect = () => {
      if (disconnected) return
      disconnected = true
      chatService.disconnectUser(socket.id)
    }

    socket.on('data', (data: Buffer) => {
      let frames
      try {
        frames = decoder.decode(data)
      } catch (err) {
        socketServer.closeConnection(
          socket,
          err instanceof FrameTooLargeError ? 1009 : 1002,
          'Bad frame'
        )
        disconnect()
        return
      }
      for (const frame of frames) {
        if (frame.type === 'text') {
          messageHandler.handle(socket.id, frame.data)
        } else if (frame.type === 'ping') {
          socket.write(encodeControlFrame(OPCODE.PONG, frame.payload))
        } else if (frame.type === 'close') {
          socket.write(encodeControlFrame(OPCODE.CLOSE, frame.payload))
          socket.end()
          disconnect()
          return
        }
      }
    })

    socket.on('error', disconnect)
    socket.on('end', disconnect)
    socket.on('close', disconnect)
  })

  return {
    port: (httpServer.address() as AddressInfo).port,
    httpServer,
    socketServer,
    rawSockets,
    chatService,
  }
}

let stack: Awaited<ReturnType<typeof startStack>> | undefined
const clients: TestClient[] = []

afterEach(async () => {
  for (const client of clients) client.close()
  clients.length = 0
  if (stack) {
    for (const socket of stack.rawSockets) socket.destroy()
    const { httpServer } = stack
    await new Promise<void>(resolve => httpServer.close(() => resolve()))
    stack = undefined
  }
})

async function connect(): Promise<TestClient> {
  const client = await TestClient.connect(stack!.port)
  clients.push(client)
  return client
}

/** Match a `{ id, userName }` payload by name. */
const named = (userName: string) => (m: { userName: string }) => m.userName === userName

describe('chat flow (end to end)', () => {
  it('answers a join with the current roster', async () => {
    stack = await startStack()
    const alice = await connect()

    alice.join('alice', 'room1')
    const frame = await alice.next(Events.UPDATE_USERS)

    expect(frame.message).toEqual([expect.objectContaining({ userName: 'alice' })])
  })

  it('tells existing members when someone joins', async () => {
    stack = await startStack()
    const alice = await connect()
    alice.join('alice', 'room1')
    await alice.next(Events.UPDATE_USERS)

    const bob = await connect()
    bob.join('bob', 'room1')

    const frame = await alice.next(Events.NEW_USER_CONNECTED, named('bob'))
    expect(frame.message).toEqual(expect.objectContaining({ userName: 'bob' }))
  })

  it('echoes the join announcement back to the joiner', async () => {
    stack = await startStack()
    const alice = await connect()

    alice.join('alice', 'room1')

    const frame = await alice.next(Events.NEW_USER_CONNECTED, named('alice'))
    expect(frame.message).toEqual(expect.objectContaining({ userName: 'alice' }))
  })

  it('gives a late joiner the full roster', async () => {
    stack = await startStack()
    const alice = await connect()
    alice.join('alice', 'room1')
    await alice.next(Events.UPDATE_USERS)

    const bob = await connect()
    bob.join('bob', 'room1')
    const frame = await bob.next(Events.UPDATE_USERS)

    expect(frame.message).toEqual([
      expect.objectContaining({ userName: 'alice' }),
      expect.objectContaining({ userName: 'bob' }),
    ])
  })

  it('broadcasts a chat message to every member of the room', async () => {
    stack = await startStack()
    const alice = await connect()
    const bob = await connect()
    alice.join('alice', 'room1')
    bob.join('bob', 'room1')
    await bob.next(Events.UPDATE_USERS)

    alice.send(Events.MESSAGE, 'hello everyone')

    expect((await bob.next(Events.MESSAGE)).message).toEqual({
      userName: 'alice',
      message: 'hello everyone',
    })
    expect((await alice.next(Events.MESSAGE)).message).toEqual({
      userName: 'alice',
      message: 'hello everyone',
    })
  })

  it('keeps rooms isolated from each other', async () => {
    stack = await startStack()
    const alice = await connect()
    const carol = await connect()
    alice.join('alice', 'room1')
    carol.join('carol', 'room2')
    await carol.next(Events.UPDATE_USERS)

    alice.send(Events.MESSAGE, 'room1 only')
    await alice.next(Events.MESSAGE)

    expect(carol.frames.some(f => f.event === Events.MESSAGE)).toBe(false)
  })

  it('notifies the room when a member hangs up', async () => {
    stack = await startStack()
    const alice = await connect()
    alice.join('alice', 'room1')
    await alice.next(Events.UPDATE_USERS)

    const bob = await RawSocketClient.connect(stack.port)
    bob.send(Events.JOIN_ROOM, { userName: 'bob', roomId: 'room1' })
    await alice.next(Events.NEW_USER_CONNECTED, named('bob'))

    bob.hangUp()

    const frame = await alice.next(Events.DISCONNECT_USER, named('bob'))
    expect(frame.message).toEqual(expect.objectContaining({ userName: 'bob' }))
  })

  it('notifies the room when a member drops abruptly', async () => {
    stack = await startStack()
    const alice = await connect()
    alice.join('alice', 'room1')
    await alice.next(Events.UPDATE_USERS)

    const bob = await RawSocketClient.connect(stack.port)
    bob.send(Events.JOIN_ROOM, { userName: 'bob', roomId: 'room1' })
    await alice.next(Events.NEW_USER_CONNECTED, named('bob'))

    bob.destroy()

    const frame = await alice.next(Events.DISCONNECT_USER, named('bob'))
    expect(frame.message).toEqual(expect.objectContaining({ userName: 'bob' }))
  })

  it('ignores a message from a client that never joined a room', async () => {
    stack = await startStack()
    const alice = await connect()
    alice.join('alice', 'room1')
    await alice.next(Events.UPDATE_USERS)

    const lurker = await connect()
    lurker.send(Events.MESSAGE, 'shouting into the void')
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(alice.frames.some(f => f.event === Events.MESSAGE)).toBe(false)
  })

  it('ignores an unknown event without dropping the connection', async () => {
    stack = await startStack()
    const alice = await connect()
    alice.join('alice', 'room1')
    await alice.next(Events.UPDATE_USERS)

    alice.send('somethingNobodyImplemented', { nope: true })
    alice.send(Events.MESSAGE, 'still connected')

    expect((await alice.next(Events.MESSAGE)).message).toEqual({
      userName: 'alice',
      message: 'still connected',
    })
  })

  it('stays up when a client sends malformed JSON', async () => {
    stack = await startStack()
    const alice = await connect()
    alice.join('alice', 'room1')
    await alice.next(Events.UPDATE_USERS)

    const bob = await connect()
    bob.sendRaw('literally not json')
    bob.join('bob', 'room1')

    const frame = await alice.next(Events.NEW_USER_CONNECTED, named('bob'))
    expect(frame.message).toEqual(expect.objectContaining({ userName: 'bob' }))
  })

  it('lets a client move to another room', async () => {
    stack = await startStack()
    const alice = await connect()
    alice.join('alice', 'room1')
    await alice.next(Events.UPDATE_USERS)

    alice.join('alice', 'room2')
    const frame = await alice.next(Events.UPDATE_USERS)

    expect(frame.message).toEqual([expect.objectContaining({ userName: 'alice' })])
  })

  it('relays a payload that needs the 16-bit extended length header', async () => {
    stack = await startStack()
    const alice = await connect()
    const bob = await connect()
    alice.join('alice', 'room1')
    bob.join('bob', 'room1')
    await bob.next(Events.UPDATE_USERS)

    const long = 'x'.repeat(4000)
    alice.send(Events.MESSAGE, long)

    expect((await bob.next(Events.MESSAGE)).message).toEqual({
      userName: 'alice',
      message: long,
    })
  })

  it('relays a payload larger than a single TCP segment', async () => {
    stack = await startStack()
    const alice = await connect()
    const bob = await connect()
    alice.join('alice', 'room1')
    bob.join('bob', 'room1')
    await bob.next(Events.UPDATE_USERS)

    // Comfortably past the ~64 KiB the kernel hands over in one chunk, so the
    // frame only arrives if the decoder reassembles it.
    const huge = 'x'.repeat(200_000)
    alice.send(Events.MESSAGE, huge)

    expect((await bob.next(Events.MESSAGE)).message).toEqual({
      userName: 'alice',
      message: huge,
    })
  })

  it('relays two messages sent back to back in the same tick', async () => {
    stack = await startStack()
    const alice = await connect()
    const bob = await connect()
    alice.join('alice', 'room1')
    bob.join('bob', 'room1')
    await bob.next(Events.UPDATE_USERS)

    // Both frames land in one TCP segment.
    alice.send(Events.MESSAGE, 'first')
    alice.send(Events.MESSAGE, 'second')

    expect((await bob.next(Events.MESSAGE)).message).toEqual({
      userName: 'alice',
      message: 'first',
    })
    expect((await bob.next(Events.MESSAGE)).message).toEqual({
      userName: 'alice',
      message: 'second',
    })
  })

  it('relays a burst of messages without losing any', async () => {
    stack = await startStack()
    const alice = await connect()
    const bob = await connect()
    alice.join('alice', 'room1')
    bob.join('bob', 'room1')
    await bob.next(Events.UPDATE_USERS)

    for (let i = 0; i < 25; i++) alice.send(Events.MESSAGE, `burst-${i}`)

    const seen: string[] = []
    for (let i = 0; i < 25; i++) {
      const frame = await bob.next(Events.MESSAGE)
      seen.push((frame.message as { message: string }).message)
    }
    expect(seen).toEqual(Array.from({ length: 25 }, (_, i) => `burst-${i}`))
  })

  it('removes a client that closes with a WebSocket close frame', async () => {
    stack = await startStack()
    const alice = await connect()
    alice.join('alice', 'room1')
    await alice.next(Events.UPDATE_USERS)

    const bob = await connect()
    bob.join('bob', 'room1')
    await alice.next(Events.NEW_USER_CONNECTED, named('bob'))

    // `WebSocket.close()` sends a close frame rather than dropping the socket.
    bob.close()

    const frame = await alice.next(Events.DISCONNECT_USER, named('bob'))
    expect(frame.message).toEqual(expect.objectContaining({ userName: 'bob' }))
  })

  it('drops a client that declares an oversized frame', async () => {
    stack = await startStack()
    const alice = await connect()
    alice.join('alice', 'room1')
    await alice.next(Events.UPDATE_USERS)

    const bob = await RawSocketClient.connect(stack.port)
    bob.send(Events.JOIN_ROOM, { userName: 'bob', roomId: 'room1' })
    await alice.next(Events.NEW_USER_CONNECTED, named('bob'))

    bob.sendOversizedHeader()

    const frame = await alice.next(Events.DISCONNECT_USER, named('bob'))
    expect(frame.message).toEqual(expect.objectContaining({ userName: 'bob' }))
  })

  it('stays up for everyone else after one client is dropped', async () => {
    stack = await startStack()
    const alice = await connect()
    const carol = await connect()
    alice.join('alice', 'room1')
    carol.join('carol', 'room1')
    await carol.next(Events.UPDATE_USERS)

    const bob = await RawSocketClient.connect(stack.port)
    bob.send(Events.JOIN_ROOM, { userName: 'bob', roomId: 'room1' })
    await alice.next(Events.NEW_USER_CONNECTED, named('bob'))
    bob.sendOversizedHeader()
    await alice.next(Events.DISCONNECT_USER, named('bob'))

    alice.send(Events.MESSAGE, 'still here')

    expect((await carol.next(Events.MESSAGE)).message).toEqual({
      userName: 'alice',
      message: 'still here',
    })
  })
})
