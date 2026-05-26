import { vi } from 'vitest'

export function createMockSocket(): NodeJS.Socket {
  return {
    write: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
    end: vi.fn(),
  } as unknown as NodeJS.Socket
}
