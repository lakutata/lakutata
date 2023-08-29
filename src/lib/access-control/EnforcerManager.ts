import {BaseObject} from '../base/BaseObject'
import {Configurable, Singleton} from '../../decorators/DependencyInjectionDecorators'
import {AuthStoreOptions} from '../../types/AuthStoreOptions'
import {stat, writeFile} from 'fs/promises'
import {FileAdapter} from 'casbin-file-adapter'
import TypeORMAdapter from 'typeorm-adapter'
import {Adapter, Enforcer, newEnforcer} from 'casbin'
import {DomainRBAC} from './DomainRBAC'

@Singleton(true)
export class EnforcerManager extends BaseObject {

    /**
     * 权限存储选项
     * @protected
     */
    @Configurable()
    protected readonly store: AuthStoreOptions

    protected readonly model: DomainRBAC = new DomainRBAC()

    protected adapter: Adapter

    protected _enforcer: Enforcer

    /**
     * 初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
        if (this.store.type === 'file') {
            try {
                await stat(this.store.filename)
            } catch (e) {
                await writeFile(this.store.filename, '', {encoding: 'utf-8'})
            }
            this.adapter = new FileAdapter(this.store.filename)
        } else {
            this.adapter = await TypeORMAdapter.newAdapter(this.store)
        }
        this._enforcer = await newEnforcer(this.model, this.adapter)
        await this._enforcer.loadPolicy()//加载所有规则
    }

    /**
     * 获取Enforcer
     */
    public get enforcer(): Enforcer {
        return this._enforcer
    }
}
