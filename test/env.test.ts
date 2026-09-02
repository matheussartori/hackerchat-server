import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * `env.ts` validates `process.env` while it is being evaluated and throws on
 * failure, so each case stubs the environment and re-imports the module.
 */
async function loadEnv(vars: Record<string, string | undefined>) {
  vi.resetModules()
  for (const key of ['PORT', 'LOG_LEVEL']) vi.stubEnv(key, undefined)
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value)

  return import('../src/env.js')
}

/**
 * The rejected error comes from a freshly registered module, so it is not the
 * same class object this file could import. Match on the name instead.
 */
const invalidEnvironment = { name: 'InvalidEnvironmentError' }

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('env', () => {
  it('falls back to the default port and log level', async () => {
    const { env } = await loadEnv({})

    expect(env).toEqual({ PORT: 9898, LOG_LEVEL: 'error' })
  })

  it('coerces PORT from its string form', async () => {
    const { env } = await loadEnv({ PORT: '3000' })

    expect(env.PORT).toBe(3000)
  })

  it('accepts every supported log level', async () => {
    for (const level of ['debug', 'info', 'warning', 'error'] as const) {
      const { env } = await loadEnv({ LOG_LEVEL: level })
      expect(env.LOG_LEVEL).toBe(level)
    }
  })

  it('accepts the port range boundaries', async () => {
    expect((await loadEnv({ PORT: '1' })).env.PORT).toBe(1)
    expect((await loadEnv({ PORT: '65535' })).env.PORT).toBe(65535)
  })

  it('rejects a port below the valid range', async () => {
    await expect(loadEnv({ PORT: '0' })).rejects.toMatchObject(invalidEnvironment)
  })

  it('rejects a port above the valid range', async () => {
    await expect(loadEnv({ PORT: '65536' })).rejects.toMatchObject(invalidEnvironment)
  })

  it('rejects a non-numeric port', async () => {
    await expect(loadEnv({ PORT: 'not-a-port' })).rejects.toMatchObject(invalidEnvironment)
  })

  it('rejects a fractional port', async () => {
    await expect(loadEnv({ PORT: '80.5' })).rejects.toMatchObject(invalidEnvironment)
  })

  it('rejects an unknown log level', async () => {
    await expect(loadEnv({ LOG_LEVEL: 'verbose' })).rejects.toMatchObject(invalidEnvironment)
  })

  it('names the offending variable in the error message', async () => {
    await expect(loadEnv({ PORT: 'nope' })).rejects.toThrowError(
      /Invalid environment variables[\s\S]*PORT/,
    )
  })

  it('reports every offending variable at once', async () => {
    await expect(loadEnv({ PORT: 'nope', LOG_LEVEL: 'verbose' })).rejects.toThrowError(
      /PORT[\s\S]*LOG_LEVEL/,
    )
  })
})
