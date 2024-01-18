import SocketServer from './server/SocketServer'
import Event from 'events'
import { EventTypes } from './events/Events'
import Controller from './controllers/SocketController'

const eventEmitter = new Event()

const port = process.env.PORT !== null ? Number(process.env.PORT) : 9898
const socketServer = new SocketServer({ port })

socketServer.initialize(eventEmitter)
  .then(() => {
    console.log('Socket server is running at', port)

    const controller = new Controller({ socketServer })
    eventEmitter.on(
      EventTypes.event.NEW_USER_CONNECTED,
      controller.onConnectionCreated.bind(controller)
    )
  })
  .catch(error => {
    console.error('Error starting the server', error)
  })
