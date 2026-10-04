import {BaseObject} from '../../../../lib/base/BaseObject.js'

export const VERSION: string = '1'

export class FirstObject extends BaseObject {
    public name(): string {
        return 'first'
    }
}

export class SecondObject extends BaseObject {
    public name(): string {
        return 'second'
    }
}
