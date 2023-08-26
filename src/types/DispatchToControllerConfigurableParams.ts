import {IUser} from '../interfaces/IUser'

export type DispatchToControllerConfigurableParams = {
    user?: IUser
    context?: Map<string, any>
} & Record<string, any>
