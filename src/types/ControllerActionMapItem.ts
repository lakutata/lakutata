import {Controller} from '../lib/base/Controller'
import {IConstructor} from '../interfaces/IConstructor'

export type ControllerActionMapItem<T extends Controller = Controller> = {
    pattern: Record<string, any>
    patternHash: string
    class: IConstructor<T>
    method: string | symbol | number
}
