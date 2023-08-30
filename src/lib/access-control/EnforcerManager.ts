import {BaseObject} from '../base/BaseObject'
import {Configurable, Singleton} from '../../decorators/DependencyInjectionDecorators'
import {AuthStoreOptions} from '../../types/AuthStoreOptions'
import {stat, writeFile} from 'fs/promises'
import {FileAdapter} from 'casbin-file-adapter'
import TypeORMAdapter from 'typeorm-adapter'
import {Adapter, Enforcer, newEnforcer} from 'casbin'
import {DomainRBAC} from './DomainRBAC'
import {DataSource, Entity} from 'typeorm'
import {NoSQLRule} from './NoSQLRule'
import {SQLRule} from './SQLRule'
import {As} from '../../exports/Utilities'

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
     * 创建实体的构造函数
     * 使用动态修饰将表名注入
     * @param tableName
     * @param isMongo
     * @protected
     */
    protected createEntityConstructor(tableName: string, isMongo: boolean = false): any {
        const RuleEntityConstructor: typeof NoSQLRule | typeof SQLRule = isMongo ? NoSQLRule : SQLRule
        Reflect.decorate([Entity(tableName)], RuleEntityConstructor)
        return RuleEntityConstructor
    }

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
            const entityConstructor = this.createEntityConstructor(this.tableName, this.store.type === 'mongodb')
            this._$adapter = await TypeORMAdapter.newAdapter(this.store, {customCasbinRuleEntity: entityConstructor})
            this._$datasource = As<DataSource>(this._$adapter['typeorm'])
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
