import {ActionPattern} from './ActionPattern'

export type ActionAuthOptions = {
    name?: string
    operation: string
    domain?: string | ((inp: ActionPattern) => string)
}
