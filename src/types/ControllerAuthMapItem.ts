import {ActionPattern} from './ActionPattern'

export type ControllerAuthMapItem = {
    action: string
    operation: string
    domain: string | ((inp: ActionPattern) => string)
}
