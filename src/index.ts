import SocketServer from './server/SocketServer'
import Event from 'events'
import { EventTypes } from './events/Events'
import Controller from './controllers/SocketController'
import chalk from 'chalk'

const eventEmitter = new Event()

const port = process.env.PORT !== null ? Number(process.env.PORT) : 9898
const socketServer = new SocketServer({ port })

const log = (...text: any): void => { console.log(chalk.blue('[Socket Server]'), ...text) }
const error = (...text: any): void => { console.error(chalk.blue('[Socket Server]'), [...text]) }

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
