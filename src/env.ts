import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(9898),
  LOG_LEVEL: z.enum(['debug', 'info', 'warning', 'error']).default('error'),
})

const result = envSchema.safeParse(process.env)

if (!result.success) {
  console.error('Invalid environment variables:')
  for (const [key, messages] of Object.entries(result.error.flatten().fieldErrors)) {
    console.error(`  ${key}: ${messages?.join(', ')}`)
  }
  process.exit(1)
}

export const env = result.data
