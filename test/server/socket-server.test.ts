import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AddressInfo } from 'node:net'
import type http from 'node:http'
import type net from 'node:net'
import { SocketServer, decodeFrame } from '../../src/server/socket-server.js'
import { createMockSocket, maskedFrame } from '../helpers.js'

describe('decodeFrame', () => {
  it('decodes a short masked frame', () => {
    expect(decodeFrame(maskedFrame('hello'))).toBe('hello')
  })

  it('decodes an unmasked frame', () => {
    const payload = Buffer.from('hello', 'utf8')
    const frame = Buffer.concat([Buffer.from([0x81, payload.length]), payload])
    expect(decodeFrame(frame)).toBe('hello')
  })

  it('decodes an empty payload', () => {
    expect(decodeFrame(maskedFrame(''))).toBe('')
  })

  it('decodes a 16-bit extended-length payload', () => {
    const text = 'x'.repeat(200)
    expect(decodeFrame(maskedFrame(text))).toBe(text)
  })

  it('decodes at the 16-bit boundary (65535 bytes)', () => {
    const text = 'y'.repeat(65535)
    expect(decodeFrame(maskedFrame(text))).toBe(text)
  })

  it('decodes a 64-bit extended-length payload', () => {
    const text = 'z'.repeat(70000)
    expect(decodeFrame(maskedFrame(text))).toBe(text)
  })

  it('round-trips multi-byte UTF-8', () => {
    const text = 'olá, mundo 🚀 — ünïcode'
    expect(decodeFrame(maskedFrame(text))).toBe(text)
  })

  it('round-trips JSON payloads', () => {
    const raw = JSON.stringify({ event: 'joinRoom', message: { userName: 'alice', roomId: 'r1' } })
    expect(decodeFrame(maskedFrame(raw))).toBe(raw)
  })

  it('returns null for a buffer shorter than the 2-byte header', () => {
    expect(decodeFrame(Buffer.alloc(0))).toBeNull()
    expect(decodeFrame(Buffer.from([0x81]))).toBeNull()
  })

  it('returns null when a 16-bit length header is truncated', () => {
    expect(decodeFrame(Buffer.from([0x81, 0x80 | 126, 0x00]))).toBeNull()
  })

  it('returns null when a 64-bit length header is truncated', () => {
    expect(decodeFrame(Buffer.from([0x81, 0x80 | 127, 0, 0, 0]))).toBeNull()
  })

  it('returns null when the payload is shorter than the declared length', () => {
    const frame = maskedFrame('hello')
    expect(decodeFrame(frame.subarray(0, frame.length - 2))).toBeNull()
  })

  it('does not mutate the caller-supplied buffer', () => {
    const frame = maskedFrame('hello')
    const copy = Buffer.from(frame)
    decodeFrame(frame)
    expect(frame.equals(copy)).toBe(true)
  })
})

describe('SocketServer.sendMessage', () => {
  it('writes a frame that decodes back to the event and message', async () => {
    const server = new SocketServer({ port: 0 })
    const socket = createMockSocket()

    await server.sendMessage(socket, 'message', { userName: 'alice', message: 'hi' })

    const written = vi.mocked(socket.write).mock.calls[0]![0] as unknown as Buffer
    expect(JSON.parse(decodeFrame(written)!)).toEqual({
      event: 'message',
      message: { userName: 'alice', message: 'hi' },
    })
  })

  it('uses the 16-bit length header for medium payloads', async () => {
    const server = new SocketServer({ port: 0 })
    const socket = createMockSocket()

    await server.sendMessage(socket, 'message', 'a'.repeat(500))

    const written = vi.mocked(socket.write).mock.calls[0]![0] as unknown as Buffer
    expect(written[1]).toBe(126)
    expect(decodeFrame(written)).toContain('a'.repeat(500))
  })

  it('uses the 64-bit length header for large payloads', async () => {
    const server = new SocketServer({ port: 0 })
    const socket = createMockSocket()

    await server.sendMessage(socket, 'message', 'a'.repeat(70000))

    const written = vi.mocked(socket.write).mock.calls[0]![0] as unknown as Buffer
    expect(written[1]).toBe(127)
    expect(decodeFrame(written)).toContain('a'.repeat(70000))
  })

  it('sends unmasked frames, as the spec requires of servers', async () => {
    const server = new SocketServer({ port: 0 })
    const socket = createMockSocket()

    await server.sendMessage(socket, 'ping', null)

    const written = vi.mocked(socket.write).mock.calls[0]![0] as unknown as Buffer
    expect(written[1]! & 0x80).toBe(0)
  })
})

describe('SocketServer.start', () => {
  let httpServer: http.Server | undefined

  afterEach(async () => {
    if (httpServer) {
      await new Promise<void>(resolve => httpServer!.close(() => resolve()))
      httpServer = undefined
    }
  })

  async function startOnEphemeralPort() {
    const server = new SocketServer({ port: 0 })
    httpServer = await server.start(() => {})
    const { port } = httpServer.address() as AddressInfo
    return { server, port }
  }

  it('exposes the configured port', () => {
    expect(new SocketServer({ port: 4242 }).port).toBe(4242)
  })

  it('answers /healthz with 200 OK', async () => {
    const { port } = await startOnEphemeralPort()

    const res = await fetch(`http://127.0.0.1:${port}/healthz`)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('OK\n')
  })

  it('serves a human-readable banner on any other path', async () => {
    const { port } = await startOnEphemeralPort()

    const res = await fetch(`http://127.0.0.1:${port}/`)

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Hacker chat server is running!')
  })

  it('sets permissive CORS headers', async () => {
    const { port } = await startOnEphemeralPort()

    const res = await fetch(`http://127.0.0.1:${port}/healthz`)

    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')).toContain('GET')
  })

  it('rejects when the port is already taken', async () => {
    const { port } = await startOnEphemeralPort()

    await expect(new SocketServer({ port }).start(() => {})).rejects.toMatchObject({
      code: 'EADDRINUSE',
    })
  })
})

describe('SocketServer.shutdown', () => {
  let httpServer: http.Server | undefined
  let serverSockets: net.Socket[] = []
  let clients: WebSocket[] = []

  beforeEach(() => {
    httpServer = undefined
    serverSockets = []
    clients = []
  })

  afterEach(async () => {
    for (const ws of clients) ws.close()
    for (const socket of serverSockets) socket.destroy()
    if (httpServer?.listening) {
      await new Promise<void>(resolve => httpServer!.close(() => resolve()))
    }
    httpServer = undefined
  })

  async function startTracking() {
    const server = new SocketServer({ port: 0 })
    httpServer = await server.start(socket => serverSockets.push(socket))
    return { server, port: (httpServer.address() as AddressInfo).port }
  }

  async function openClient(port: number): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    clients.push(ws)
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    return ws
  }

  it('counts live connections', async () => {
    const { server, port } = await startTracking()
    expect(server.connectionCount).toBe(0)

    await openClient(port)

    expect(server.connectionCount).toBe(1)
  })

  it('forgets a connection once it closes', async () => {
    const { server, port } = await startTracking()
    await openClient(port)

    serverSockets[0]!.destroy()
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(server.connectionCount).toBe(0)
  })

  it('resolves with no connections open', async () => {
    const { server } = await startTracking()

    await expect(server.shutdown(httpServer!)).resolves.toBeUndefined()
  })

  it('resolves even while a WebSocket is still open', async () => {
    // The whole point of the fix: `server.close()` alone would hang here,
    // because an upgraded socket never ends on its own.
    const { server, port } = await startTracking()
    await openClient(port)

    const start = Date.now()
    await server.shutdown(httpServer!)

    expect(Date.now() - start).toBeLessThan(3000)
  })

  it('sends each client a close frame before hanging up', async () => {
    const { server, port } = await startTracking()
    const ws = await openClient(port)
    const closed = new Promise<CloseEvent>(resolve => {
      ws.addEventListener('close', event => resolve(event as CloseEvent), { once: true })
    })

    await server.shutdown(httpServer!, 1001, 'going away')

    expect((await closed).code).toBe(1001)
  })

  it('stops accepting new connections', async () => {
    const { server, port } = await startTracking()
    await server.shutdown(httpServer!)

    await expect(openClient(port)).rejects.toBeDefined()
  })

  it('closes several connections at once', async () => {
    const { server, port } = await startTracking()
    const sockets = await Promise.all([openClient(port), openClient(port)])
    const allClosed = Promise.all(sockets.map(ws =>
      new Promise<void>(resolve => ws.addEventListener('close', () => resolve(), { once: true }))))

    await server.shutdown(httpServer!)

    await expect(allClosed).resolves.toBeDefined()
  })
})

describe('SocketServer.closeConnection', () => {
  let httpServer: http.Server | undefined
  const serverSockets: net.Socket[] = []

  afterEach(async () => {
    for (const socket of serverSockets) socket.destroy()
    serverSockets.length = 0
    if (httpServer?.listening) {
      await new Promise<void>(resolve => httpServer!.close(() => resolve()))
    }
    httpServer = undefined
  })

  it('closes the client with the given code and reason', async () => {
    const server = new SocketServer({ port: 0 })
    httpServer = await server.start(socket => serverSockets.push(socket))
    const port = (httpServer.address() as AddressInfo).port

    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    await new Promise<void>(resolve => ws.addEventListener('open', () => resolve(), { once: true }))
    const closed = new Promise<CloseEvent>(resolve => {
      ws.addEventListener('close', e => resolve(e as CloseEvent), { once: true })
    })

    server.closeConnection(serverSockets[0]!, 1009, 'Message too big')

    const event = await closed
    expect(event.code).toBe(1009)
    expect(event.reason).toBe('Message too big')
  })
})

describe('SocketServer upgrade handshake', () => {
  let httpServer: http.Server | undefined
  let serverSockets: NodeJS.Socket[] = []
  let clients: WebSocket[] = []

  beforeEach(() => {
    httpServer = undefined
    serverSockets = []
    clients = []
  })

  afterEach(async () => {
    for (const ws of clients) ws.close()
    // Upgraded sockets are detached from the http server's connection
    // tracking, so `close()` would hang waiting on them. Destroy them first.
    for (const socket of serverSockets) (socket as unknown as net.Socket).destroy()
    if (httpServer) {
      await new Promise<void>(resolve => httpServer!.close(() => resolve()))
      httpServer = undefined
    }
  })

  /** Start a server on an ephemeral port, recording every accepted socket. */
  async function startTrackingConnections() {
    const server = new SocketServer({ port: 0 })
    httpServer = await server.start(socket => serverSockets.push(socket))
    const { port } = httpServer.address() as AddressInfo
    return port
  }

  /** Open a client WebSocket and resolve once the handshake completes. */
  async function openClient(port: number): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    clients.push(ws)
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    return ws
  }

  it('completes the handshake and hands the caller an identified socket', async () => {
    const port = await startTrackingConnections()

    await openClient(port)

    expect(serverSockets).toHaveLength(1)
    expect((serverSockets[0] as unknown as { id: string }).id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  it('gives each connection a distinct id', async () => {
    const port = await startTrackingConnections()

    await openClient(port)
    await openClient(port)

    const ids = serverSockets.map(s => (s as unknown as { id: string }).id)
    expect(new Set(ids).size).toBe(2)
  })

  it('delivers a client frame that the server can decode', async () => {
    const port = await startTrackingConnections()
    const ws = await openClient(port)

    const received = new Promise<string | null>(resolve => {
      serverSockets[0]!.on('data', (data: Buffer) => resolve(decodeFrame(data)))
    })
    ws.send('{"event":"message","message":"over the wire"}')

    expect(await received).toBe('{"event":"message","message":"over the wire"}')
  })

  it('sends a frame the client can read back', async () => {
    const port = await startTrackingConnections()
    const ws = await openClient(port)
    const server = new SocketServer({ port: 0 })

    const received = new Promise<string>(resolve => {
      ws.addEventListener('message', event => resolve(event.data as string), { once: true })
    })
    await server.sendMessage(serverSockets[0]!, 'message', { userName: 'alice', message: 'hi' })

    expect(JSON.parse(await received)).toEqual({
      event: 'message',
      message: { userName: 'alice', message: 'hi' },
    })
  })
})
