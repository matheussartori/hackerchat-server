import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(9898),
  LOG_LEVEL: z.enum(['debug', 'info', 'warning', 'error']).default('error'),
})

/**
 * Raised while this module is being evaluated, which means before any importer
 * has had a chance to run. Nothing can catch it: a misconfigured process has no
 * useful work to do, so failing the import is the point.
 */
export class InvalidEnvironmentError extends Error {
  constructor(issues: string[]) {
    super(`Invalid environment variables:\n${issues.map(issue => `  ${issue}`).join('\n')}`)
    this.name = 'InvalidEnvironmentError'
  }
}

const result = envSchema.safeParse(process.env)

if (!result.success) {
  throw new InvalidEnvironmentError(
    Object.entries(result.error.flatten().fieldErrors)
      .map(([key, messages]) => `${key}: ${messages?.join(', ') ?? 'invalid'}`)
  )
}

export const env = result.data
