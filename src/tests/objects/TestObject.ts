import {BaseObject} from '../../exports/Core'
import {Configurable} from '../../decorators/DependencyInjectionDecorators'

export class TestObject extends BaseObject {

    @Configurable()
    protected readonly username: string

    public getUsername(): string {
        return this.username ? this.username : 'unknown'
    }
}
