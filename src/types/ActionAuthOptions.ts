import {ActionPattern} from './ActionPattern'

export type ActionAuthOptions = {
    name?: string
    act: string
    domain?: string | ((inp: ActionPattern) => string)
}
