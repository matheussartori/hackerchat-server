import pino from 'pino'
import { env } from '../env.js'

const LEVEL_MAP: Record<string, string> = {
  debug: 'debug',
  info: 'info',
  warning: 'warn',
  error: 'error',
}

const root = pino({ level: LEVEL_MAP[env.LOG_LEVEL] })

export interface Logger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

function toLogArgs(args: unknown[]): [Record<string, unknown> | undefined, string] {
  const parts: string[] = []
  let err: Error | undefined

  for (const arg of args) {
    if (arg instanceof Error) {
      err = arg
      parts.push(arg.message)
    } else {
      parts.push(String(arg ?? ''))
    }
  }

  return err ? [{ err }, parts.join(' ')] : [undefined, parts.join(' ')]
}

export function createLogger(module: string): Logger {
  const child = root.child({ module })

  function log(level: 'debug' | 'info' | 'warn' | 'error', args: unknown[]): void {
    const [obj, msg] = toLogArgs(args)
    if (obj !== undefined) {
      child[level](obj, msg)
    } else {
      child[level](msg)
    }
  }

  return {
    debug: (...args) => { log('debug', args) },
    info: (...args) => { log('info', args) },
    warn: (...args) => { log('warn', args) },
    error: (...args) => { log('error', args) },
  }
}
