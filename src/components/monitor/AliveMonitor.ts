import {createServer, IncomingMessage, Server, ServerResponse} from 'node:http'
import {Component} from '../../lib/core/Component.js'
import {Configurable} from '../../decorators/di/Configurable.js'
import {DTO} from '../../lib/core/DTO.js'

export class AliveMonitor extends Component {
    @Configurable(DTO.Number().port().required())
    protected readonly port: number

    #server: Server = createServer((req: IncomingMessage, res: ServerResponse): void => {
        res.writeHead(200, {'Content-Type': 'text/plain'})
        res.end('alive')
    })

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            try {
                this.#server.listen(this.port, '0.0.0.0', (): void => resolve())
            } catch (e) {
                return reject(e)
            }
        })
    }

    /**
     * Destroyer
     * @protected
     */
    protected async destroy(): Promise<void> {
        await new Promise<void>((resolve, reject): Server => this.#server.close(err => err ? reject(err) : resolve()))
    }
}