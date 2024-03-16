import {Component} from '../lib/core/Component.js'
import {Configurable} from '../decorators/di/Configurable.js'
import {CLIContext} from '../lib/context/CLIContext.js'
import {HTTPContext} from '../lib/context/HTTPContext.js'
import {ServiceContext} from '../lib/context/ServiceContext.js'
import {Container} from '../lib/core/Container.js'
import {ActionPattern} from '../types/ActionPattern.js'

export type CLIEntrypoint = (handler: (context: CLIContext) => Promise<unknown>) => void
export type HTTPEntrypoint = (handler: (context: HTTPContext) => Promise<unknown>) => void
export type ServiceEntrypoint = (handler: (context: ServiceContext) => Promise<unknown>) => void

export class Entrypoint extends Component {

    @Configurable()
    public cli?: CLIEntrypoint | CLIEntrypoint[]

    @Configurable()
    public http?: HTTPEntrypoint | HTTPEntrypoint[]

    @Configurable()
    public service?: ServiceEntrypoint | ServiceEntrypoint[]

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        this.register(this.service, (entrypoint: ServiceEntrypoint) => this.registerServiceEntrypoint(entrypoint))
        this.register(this.cli, (entrypoint: CLIEntrypoint) => this.registerCLIEntrypoint(entrypoint))
        this.register(this.http, (entrypoint: HTTPEntrypoint) => this.registerHTTPEntrypoint(entrypoint))
    }

    /**
     * Register
     * @param eps
     * @param registerFunc
     * @protected
     */
    protected register<T>(eps: any | any[] | undefined, registerFunc: (entrypoint: T) => void): void {
        (eps ? Array.isArray(eps) ? eps : [eps] : []).forEach((entrypoint: T) => registerFunc(entrypoint))
    }

    /**
     * Register CLI entrypoint
     * @param entrypoint
     * @protected
     */
    protected registerCLIEntrypoint(entrypoint: CLIEntrypoint): void {
        //TODO
    }

    /**
     * Register http entrypoint
     * @param entrypoint
     * @protected
     */
    protected registerHTTPEntrypoint(entrypoint: HTTPEntrypoint): void {
        return entrypoint(async (context: HTTPContext) => {
            const actionPattern: ActionPattern = {
                route: context.route,
                method: context.method
            }
            const runtimeScope: Container = this.createScope()

            //TODO 需要将actions的信息传入

            // runtimeScope.get()
            console.log(context)
            return {test: true}
        })
    }

    /**
     * Register service entrypoint
     * @param entrypoint
     * @protected
     */
    protected registerServiceEntrypoint(entrypoint: ServiceEntrypoint): void {
        //TODO
    }
}
