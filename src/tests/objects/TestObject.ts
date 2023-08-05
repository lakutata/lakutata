import {BaseObject} from '../../Core.js'
import {Configurable} from '../../decorators/DependencyInjectionDecorators.js'

export class TestObject extends BaseObject {

    @Configurable()
    protected readonly username: string

    public getUsername(): string {
        return this.username ? this.username : 'unknown'
    }
}
