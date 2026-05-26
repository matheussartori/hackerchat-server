export const Events = {
  JOIN_ROOM: 'joinRoom',
  MESSAGE: 'message',
  NEW_USER_CONNECTED: 'newUserConnected',
  DISCONNECT_USER: 'disconnectUser',
  UPDATE_USERS: 'updateUsers',
} as const

export type EventName = (typeof Events)[keyof typeof Events]
