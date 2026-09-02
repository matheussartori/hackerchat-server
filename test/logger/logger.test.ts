import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Writable } from 'node:stream'

/**
 * The logger binds pino to `env.LOG_LEVEL` at import time, so each case
 * re-imports it with a fresh module registry and a captured destination.
 */
async function loadLogger(logLevel: string) {
  vi.resetModules()
  vi.stubEnv('LOG_LEVEL', logLevel)

  const lines: Record<string, unknown>[] = []
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) lines.push(JSON.parse(line) as Record<string, unknown>)
      }
      callback()
    },
  })

  const actual = await vi.importActual<{ default: typeof import('pino').pino }>('pino')
  const realPino = actual.default
  vi.doMock('pino', () => ({
    default: (opts: Parameters<typeof realPino>[0]) => realPino(opts, destination),
  }))

  const { createLogger } = await import('../../src/logger/logger.js')
  return { createLogger, lines }
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.doUnmock('pino')
  vi.restoreAllMocks()
})

describe('createLogger', () => {
  it('tags every line with the module name', async () => {
    const { createLogger, lines } = await loadLogger('debug')

    createLogger('Widgets').info('hello')

    expect(lines[0]).toMatchObject({ module: 'Widgets', msg: 'hello' })
  })

  it('joins multiple arguments into one message', async () => {
    const { createLogger, lines } = await loadLogger('debug')

    createLogger('Widgets').info('user', 'alice', 'joined')

    expect(lines[0]).toMatchObject({ msg: 'user alice joined' })
  })

  it('stringifies non-string arguments', async () => {
    const { createLogger, lines } = await loadLogger('debug')

    createLogger('Widgets').info('count', 42, true)

    expect(lines[0]).toMatchObject({ msg: 'count 42 true' })
  })

  it('renders null and undefined as empty strings', async () => {
    const { createLogger, lines } = await loadLogger('debug')

    createLogger('Widgets').info('value:', null, undefined)

    expect(lines[0]).toMatchObject({ msg: 'value:  ' })
  })

  it('attaches an Error as structured context and uses its message', async () => {
    const { createLogger, lines } = await loadLogger('debug')

    createLogger('Widgets').error('failed:', new Error('boom'))

    expect(lines[0]).toMatchObject({ msg: 'failed: boom' })
    expect(lines[0]!.err).toMatchObject({ message: 'boom', type: 'Error' })
  })

  it('maps each level onto the matching pino level', async () => {
    const { createLogger, lines } = await loadLogger('debug')
    const log = createLogger('Widgets')

    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')

    expect(lines.map(l => l.level)).toEqual([20, 30, 40, 50])
  })

  it('maps the "warning" env level onto pino\'s "warn"', async () => {
    const { createLogger, lines } = await loadLogger('warning')
    const log = createLogger('Widgets')

    log.info('dropped')
    log.warn('kept')

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ msg: 'kept' })
  })

  it('suppresses everything below the configured level', async () => {
    const { createLogger, lines } = await loadLogger('error')
    const log = createLogger('Widgets')

    log.debug('no')
    log.info('no')
    log.warn('no')
    log.error('yes')

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ msg: 'yes' })
  })

  it('keeps separate module tags for separate loggers', async () => {
    const { createLogger, lines } = await loadLogger('debug')

    createLogger('A').info('from a')
    createLogger('B').info('from b')

    expect(lines.map(l => l.module)).toEqual(['A', 'B'])
  })
})
