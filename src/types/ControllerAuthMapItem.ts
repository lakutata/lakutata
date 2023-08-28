import {ActionPattern} from './ActionPattern'

export type ControllerAuthMapItem = {
    obj: string
    act: string
    domain: string | ((inp: ActionPattern) => string)
}
