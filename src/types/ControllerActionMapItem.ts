import {Controller} from '../lib/base/Controller.js'
import {IConstructor} from '../interfaces/IConstructor.js'

export type ControllerActionMapItem<T extends Controller = Controller> = {
    pattern: Record<string, any>
    patternHash: string
    class: IConstructor<T>
    method: string | symbol | number
}
