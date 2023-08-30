import {BaseObject} from '../base/BaseObject'
import {Configurable, Singleton} from '../../decorators/DependencyInjectionDecorators'
import {AuthStoreOptions} from '../../types/AuthStoreOptions'
import {stat, writeFile} from 'fs/promises'
import {FileAdapter} from 'casbin-file-adapter'
import {Adapter, Enforcer, newEnforcer} from 'casbin'
import {DomainRBAC} from './DomainRBAC'
import {As} from '../../Helper'
import {DatabaseAdapter} from './DatabaseAdapter'
import { DataSource } from '../../ORM'

@Singleton(true)
export class EnforcerManager extends BaseObject {

    /**
     * 权限存储选项
     * @protected
     */
    @Configurable()
    protected readonly store: AuthStoreOptions

    /**
     * 权限存储的表名
     * 仅在使用数据库作为权限存储的情况下有效
     * @protected
     */
    @Configurable()
    protected readonly tableName: string = 'permission_rules'

    protected readonly model: DomainRBAC = new DomainRBAC()

    protected _$adapter: Adapter

    protected _$enforcer: Enforcer

    protected _$datasource: DataSource

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
            this._$adapter = new FileAdapter(this.store.filename)
        } else {
            this._$adapter = await DatabaseAdapter.createAdapter(this.store, this.tableName)
            this._$datasource = As<DataSource>(this._$adapter['datasource'])
        }
        this._$enforcer = await newEnforcer(this.model, this._$adapter)
        await this._$enforcer.loadPolicy()//加载所有规则
    }

    /**
     * 销毁函数
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.setProperty('_$enforcer', null)
        this.setProperty('_$adapter', null)
        if (this._$datasource) await this._$datasource.destroy()
    }

    /**
     * 获取Enforcer
     */
    public get enforcer(): Enforcer {
        return this._$enforcer
    }
}
