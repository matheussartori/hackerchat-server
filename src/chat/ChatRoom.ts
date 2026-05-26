import type { ChatUser } from '../types/chat.js'

export class ChatRoom {
  readonly id: string
  private readonly users = new Map<string, ChatUser>()

  constructor(id: string) {
    this.id = id
  }

  addUser(user: ChatUser): void {
    this.users.set(user.id, user)
  }

  removeUser(userId: string): boolean {
    return this.users.delete(userId)
  }

  getUser(userId: string): ChatUser | undefined {
    return this.users.get(userId)
  }

  getUsers(): ChatUser[] {
    return Array.from(this.users.values())
  }

  hasUser(userId: string): boolean {
    return this.users.has(userId)
  }

  isEmpty(): boolean {
    return this.users.size === 0
  }
}
