import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * `env.ts` validates `process.env` at import time and calls `process.exit(1)`
 * on failure, so each case stubs the environment and re-imports the module.
 */
async function loadEnv(vars: Record<string, string | undefined>) {
  vi.resetModules()
  for (const key of ['PORT', 'LOG_LEVEL']) vi.stubEnv(key, undefined)
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value)

  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  const errors: unknown[][] = []
  const consoleError = vi
    .spyOn(console, 'error')
    .mockImplementation((...args: unknown[]) => void errors.push(args))

  const mod = await import('../src/env.js')
  return { env: mod.env, exit, errors, consoleError }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('env', () => {
  it('falls back to the default port and log level', async () => {
    const { env, exit } = await loadEnv({})

    expect(env).toEqual({ PORT: 9898, LOG_LEVEL: 'error' })
    expect(exit).not.toHaveBeenCalled()
  })

  it('coerces PORT from its string form', async () => {
    const { env } = await loadEnv({ PORT: '3000' })

    expect(env.PORT).toBe(3000)
  })

  it('accepts every supported log level', async () => {
    for (const level of ['debug', 'info', 'warning', 'error'] as const) {
      const { env, exit } = await loadEnv({ LOG_LEVEL: level })
      expect(env.LOG_LEVEL).toBe(level)
      expect(exit).not.toHaveBeenCalled()
    }
  })

  it('accepts the port range boundaries', async () => {
    expect((await loadEnv({ PORT: '1' })).env.PORT).toBe(1)
    expect((await loadEnv({ PORT: '65535' })).env.PORT).toBe(65535)
  })

  it('rejects a port below the valid range', async () => {
    const { exit } = await loadEnv({ PORT: '0' })

    expect(exit).toHaveBeenCalledWith(1)
  })

  it('rejects a port above the valid range', async () => {
    const { exit } = await loadEnv({ PORT: '65536' })

    expect(exit).toHaveBeenCalledWith(1)
  })

  it('rejects a non-numeric port', async () => {
    const { exit } = await loadEnv({ PORT: 'not-a-port' })

    expect(exit).toHaveBeenCalledWith(1)
  })

  it('rejects a fractional port', async () => {
    const { exit } = await loadEnv({ PORT: '80.5' })

    expect(exit).toHaveBeenCalledWith(1)
  })

  it('rejects an unknown log level', async () => {
    const { exit } = await loadEnv({ LOG_LEVEL: 'verbose' })

    expect(exit).toHaveBeenCalledWith(1)
  })

  it('names the offending variable in the error output', async () => {
    const { errors } = await loadEnv({ PORT: 'nope' })

    const output = errors.flat().join(' ')
    expect(output).toContain('Invalid environment variables')
    expect(output).toContain('PORT')
  })
})
