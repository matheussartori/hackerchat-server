import { describe, it, expect, beforeEach } from 'vitest'
import { ChatRoom } from '../../src/chat/ChatRoom.js'
import type { ChatUser } from '../../src/types/chat.js'
import { createMockSocket } from '../helpers.js'

function makeUser(id: string): ChatUser {
  return { id, socket: createMockSocket(), userName: `user_${id}`, roomId: 'room1' }
}

describe('ChatRoom', () => {
  let room: ChatRoom

  beforeEach(() => {
    room = new ChatRoom('room1')
  })

  it('starts empty', () => {
    expect(room.isEmpty()).toBe(true)
    expect(room.getUsers()).toHaveLength(0)
  })

  it('exposes its id', () => {
    expect(room.id).toBe('room1')
  })

  it('adds a user', () => {
    room.addUser(makeUser('u1'))
    expect(room.getUsers()).toHaveLength(1)
    expect(room.isEmpty()).toBe(false)
  })

  it('adds multiple users', () => {
    room.addUser(makeUser('u1'))
    room.addUser(makeUser('u2'))
    room.addUser(makeUser('u3'))
    expect(room.getUsers()).toHaveLength(3)
  })

  it('overrides an existing user when the same id is added again', () => {
    const user = makeUser('u1')
    room.addUser(user)
    const updated = { ...user, userName: 'updated' }
    room.addUser(updated)
    expect(room.getUsers()).toHaveLength(1)
    expect(room.getUser('u1')?.userName).toBe('updated')
  })

  it('removes an existing user', () => {
    room.addUser(makeUser('u1'))
    const removed = room.removeUser('u1')
    expect(removed).toBe(true)
    expect(room.isEmpty()).toBe(true)
  })

  it('returns false when removing a non-existent user', () => {
    expect(room.removeUser('nonexistent')).toBe(false)
  })

  it('checks if a user exists', () => {
    room.addUser(makeUser('u1'))
    expect(room.hasUser('u1')).toBe(true)
    expect(room.hasUser('u2')).toBe(false)
  })

  it('returns a user by id', () => {
    const user = makeUser('u1')
    room.addUser(user)
    expect(room.getUser('u1')).toBe(user)
  })

  it('returns undefined for a missing user id', () => {
    expect(room.getUser('missing')).toBeUndefined()
  })

  it('returns all users as an array', () => {
    const u1 = makeUser('u1')
    const u2 = makeUser('u2')
    room.addUser(u1)
    room.addUser(u2)
    expect(room.getUsers()).toContain(u1)
    expect(room.getUsers()).toContain(u2)
  })
})
