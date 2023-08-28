import {IUser} from '../../interfaces/IUser'
import {Configurable, Scoped} from '../../decorators/DependencyInjectionDecorators'
import {Adapter, Enforcer, newEnforcer} from 'casbin'
import {DomainRBAC} from './models/DomainRBAC'
import {AuthStoreOptions} from '../../types/AuthStoreOptions'
import TypeORMAdapter from 'typeorm-adapter'
import {stat, writeFile} from 'fs/promises'
import {Component} from '../base/Component'
import {FileAdapter} from 'casbin-file-adapter'
import {NoAuthUserException} from '../../exceptions/auth/NoAuthUserException'

@Scoped(true)
export class AccessControl extends Component {

    /**
     * 权限存储选项
     * @protected
     */
    @Configurable()
    protected readonly store: AuthStoreOptions

    @Configurable()
    protected readonly user: IUser

    protected enforcer: Enforcer

    /**
     * 访问管理是否已被配置
     */
    public get configured(): boolean {
        return !!this.enforcer
    }

    /**
     * 内部初始化函数
     * @protected
     */
    protected async __init(): Promise<void> {
        await super.__init()
        if (this.store) {
            if (!this.user) throw new NoAuthUserException('Auth user is required.')
            let policy: Adapter
            if (this.store.type === 'file') {
                try {
                    await stat(this.store.filename)
                } catch (e) {
                    await writeFile(this.store.filename, '', {encoding: 'utf-8'})
                }
                policy = new FileAdapter(this.store.filename)
            } else {
                policy = await TypeORMAdapter.newAdapter(this.store)
            }
            this.enforcer = await newEnforcer(new DomainRBAC(), policy)
            if (this.user && this.store.type !== 'file') {
                await this.enforcer.loadFilteredPolicy({
                    ptype: 'p',
                    v0: this.user.id
                })//加载用户规则
            } else {
                await this.enforcer.loadPolicy()//加载所有规则
            }
        }
    }

    /**
     * 内部销毁函数
     * @protected
     */
    protected async __destroy(): Promise<void> {
        //todo
        return await super.__destroy()
    }

    /**
     * 执行鉴权
     * @param obj
     * @param dom
     * @param act
     */
    public async validate(obj: string, dom: string, act: string): Promise<boolean> {
        return await this.enforcer.enforce(this.user.id, dom, obj, act)
    }

}
