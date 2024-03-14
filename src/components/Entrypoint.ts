import {Component} from '../lib/core/Component.js'
import {Configurable} from '../decorators/di/Configurable.js'
import {CLIContext} from '../lib/context/CLIContext.js'
import {HTTPContext} from '../lib/context/HTTPContext.js'
import {ServiceContext} from '../lib/context/ServiceContext.js'

export class Entrypoint extends Component {

    @Configurable()
    public cli: () => CLIContext

    @Configurable()
    public http: () => HTTPContext

    @Configurable()
    public service: () => ServiceContext
}
