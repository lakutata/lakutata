import {ActionPattern} from './ActionPattern'

export type ControllerAuthConfigItem = {
    action: string
    operation: string
    domain: string | ((inp: ActionPattern) => string)
}
