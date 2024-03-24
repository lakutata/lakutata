import {ICType} from '../interfaces/ICType.js'

export type LibFunction = {
    (...args: any[]): any
    async: (...args: any[]) => any
    info: {
        name: string,
        arguments: ICType[],
        result: ICType
    }
}
