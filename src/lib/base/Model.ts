import {Component} from './Component.js'
import {InjectionProperties} from '../../types/InjectionProperties.js'
import {Lifetime} from '../../decorators/DependencyInjectionDecorators.js'

@Lifetime('TRANSIENT', false)
export class Model extends Component {

    /**
     * Constructor
     * @param properties
     */
    constructor(properties: InjectionProperties = {}) {
        super(properties)
    }



}
