import {IPermission} from './IPermission'

export interface IUserPermission extends IPermission {
    domain: string
}
