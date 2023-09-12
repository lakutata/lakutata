import {IUser} from '../interfaces/IUser'

export type DispatchToControllerConfigurableParams = {
    user?: IUser
    context?: Record<string, any>
} & Record<string, any>
