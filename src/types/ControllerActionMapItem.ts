import {Controller} from '../lib/base/Controller'
import {IConstructor} from '../interfaces/IConstructor'
import {ActionPattern} from './ActionPattern'

export type ControllerActionMapItem<T extends Controller = Controller> = {
    pattern: ActionPattern
    patternHash: string
    class: IConstructor<T>
    method: string | symbol | number
}
