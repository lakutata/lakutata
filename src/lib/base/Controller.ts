import {Component} from './Component.js'
import {InjectionProperties} from '../../types/InjectionProperties.js'

/**
 * 控制器基类
 */
export class Controller extends Component {

    /**
     * Constructor
     * @param properties
     */
    constructor(properties: InjectionProperties = {}) {
        super(properties)
        this.setInternalProperty('type', 'Controller')
    }

    protected async __init(): Promise<void> {
        return super.__init()
    }

    protected async __destroy(): Promise<void> {
        return super.__destroy()
    }
}
