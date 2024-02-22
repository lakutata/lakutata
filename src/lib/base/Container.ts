import {createContainer, IDependencyInjectionContainer} from '../ioc/DependencyInjectionContainer.js'

export class Container {

    #dic: IDependencyInjectionContainer

    constructor(parent?: Container) {
        this.#dic = parent ? parent.#dic.createScope() : createContainer({injectionMode: 'PROXY', strict: true})
    }

    /**
     * Create sub container scope
     */
    public createScope(): Container {
        return new Container(this)
    }

    /**
     * Destroy current container
     */
    public async destroy(): Promise<void> {
        await this.#dic.dispose()
    }
}
