export interface ParsedMessage {
  event: string
  message: unknown
}

export class MessageParseError extends Error {
  constructor(
    message: string,
    public readonly raw: string
  ) {
    super(message)
    this.name = 'MessageParseError'
  }
}

export function parseMessage(raw: string): ParsedMessage {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new MessageParseError('Invalid JSON', raw)
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('event' in parsed) ||
    typeof (parsed as Record<string, unknown>).event !== 'string'
  ) {
    throw new MessageParseError('Missing or invalid "event" field', raw)
  }

  return {
    event: (parsed as Record<string, unknown>).event as string,
    message: (parsed as Record<string, unknown>).message,
  }
}
