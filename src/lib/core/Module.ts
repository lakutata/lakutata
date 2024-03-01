import {Component} from './Component.js'
import {Singleton} from '../../decorators/di/Lifetime.js'

/**
 * Module base class
 */
@Singleton(true)
export class Module extends Component {
    constructor() {
        super({})
    }
}
