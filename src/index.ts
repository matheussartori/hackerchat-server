import SocketServer from './server/SocketServer.js'
import Event from 'node:events'
import { EventTypes } from './events/Events.js'
import Controller from './controllers/SocketController.js'
import pc from 'picocolors'

const eventEmitter = new Event()

const port = process.env.PORT !== undefined ? Number(process.env.PORT) : 9898
const socketServer = new SocketServer({ port })

const log = (...text: unknown[]): void => { console.log(pc.blue('[Socket Server]'), ...text) }
const error = (...text: unknown[]): void => { console.error(pc.blue('[Socket Server]'), ...text) }

socketServer.initialize(eventEmitter)
  .then(() => {
    log('Running at port', port)

    const controller = new Controller({ socketServer })
    eventEmitter.on(
      EventTypes.event.NEW_USER_CONNECTED,
      controller.onConnectionCreated.bind(controller)
    )
  })
  .catch(err => {
    error('Error starting the server', err)
  })
