import {Component} from '../lib/core/Component.js'
import {Configurable} from '../decorators/di/Configurable.js'

export class Entrypoint extends Component {

    @Configurable()
    public cli: any

    @Configurable()
    public http: () => any

    @Configurable()
    public service: any
}
