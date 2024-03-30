import {PrototypeInfo} from './PrototypeInfo.js'

export type LibFunction = {
    (...args: any[]): any;
    async: (...args: any[]) => any;
    info: PrototypeInfo;
}
