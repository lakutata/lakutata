import {IUser} from '../../interfaces/IUser'
import {Configurable, Transient} from '../../decorators/DependencyInjectionDecorators'
import {Adapter, Enforcer, newEnforcer} from 'casbin'
import {DomainRBAC} from './models/DomainRBAC'
import {AuthStoreOptions} from '../../types/AuthStoreOptions'
import TypeORMAdapter from 'typeorm-adapter'
import {stat, writeFile} from 'fs/promises'
import {Component} from '../base/Component'
import {FileAdapter} from 'casbin-file-adapter'
import {NoAuthUserException} from '../../exceptions/auth/NoAuthUserException'
import {defaultDomain} from '../../constants/DefaultValue'
import {IPermission} from '../../interfaces/auth/IPermission'

/**
 * 使用该修饰器强制验证组件内所加载的用户必须存在
 * @constructor
 */
function AuthUserRequired(): MethodDecorator {
    return function <T>(target: Object, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<T>): TypedPropertyDescriptor<T> {
        const originMethod: any = descriptor.value
        if (originMethod) {
            descriptor.value = (function (this: AccessControl, ...args: any[]): any {
                if (!this.user) throw new NoAuthUserException('Auth user is required.')
                return originMethod.apply(this, [...args])
            }) as any
        }
        return descriptor
    }
}

@Transient(true)
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
        this.setProperty('enforcer', null)//强制置为NULL
        return await super.__destroy()
    }

    /**
     * 执行鉴权
     * @param action
     * @param domain
     * @param operation
     */
    @AuthUserRequired()
    public async validate(action: string, domain: string, operation: string): Promise<boolean> {
        return await this.enforcer.enforce(this.user.id, domain, action, operation)
    }

    /**
     * 创建用户权限
     * @param action
     * @param operation
     * @param domain
     */
    @AuthUserRequired()
    public async createUserPermission(action: string, operation: string, domain: string = defaultDomain): Promise<boolean> {
        return (await this.enforcer.addPermissionForUser(this.user.id, domain, action, operation)) && (await this.enforcer.savePolicy())
    }

    /**
     * 删除用户权限
     * @param action
     * @param operation
     * @param domain
     */
    @AuthUserRequired()
    public async removeUserPermission(action: string, operation: string, domain: string = defaultDomain): Promise<boolean> {
        return (await this.enforcer.deletePermissionForUser(this.user.id, domain, action, operation)) && (await this.enforcer.savePolicy())
    }

    /**
     * 获取用户权限列表
     */
    @AuthUserRequired()
    public async listUserPermission(): Promise<IPermission[]> {
        const rawPermissions: string[][] = await this.enforcer.getPermissionsForUser(this.user.id)
        return rawPermissions.map((rawPermission: string[]) => ({
            action: rawPermission[2],
            operation: rawPermission[3],
            domain: rawPermission[1]
        }))
    }

    /**
     * 将角色分配给用户
     * @param role
     * @param domain
     */
    @AuthUserRequired()
    public async assignRoleToUser(role: string, domain: string = defaultDomain): Promise<boolean> {
        return (await this.enforcer.addRoleForUser(this.user.id, role, domain)) && (await this.enforcer.savePolicy())
    }

    /**
     * 删除用户角色
     * @param role
     * @param domain
     */
    @AuthUserRequired()
    public async removeRoleFromUser(role: string, domain: string = defaultDomain): Promise<boolean> {
        return (await this.enforcer.deleteRoleForUser(this.user.id, role, domain)) && (await this.enforcer.savePolicy())
    }

    /**
     * 获取用户拥有的角色列表
     * @param domain
     */
    @AuthUserRequired()
    public async listUserRoles(domain: string = defaultDomain): Promise<string[]> {
        return await this.enforcer.getRolesForUserInDomain(this.user.id, domain)
    }

    /**
     * 清除用户所有权限信息
     */
    @AuthUserRequired()
    public async clearUserInfo(): Promise<boolean> {
        return (await this.enforcer.deleteUser(this.user.id)) && (await this.enforcer.savePolicy())
    }

    /**
     * 创建角色权限
     * @param role
     * @param action
     * @param operation
     * @param domain
     */
    public async createRolePermission(role: string, action: string, operation: string, domain: string = defaultDomain): Promise<boolean> {
        return (await this.enforcer.addPolicy(role, domain, action, operation)) && (await this.enforcer.savePolicy())
    }

    /**
     * 删除角色权限
     * @param role
     * @param action
     * @param operation
     * @param domain
     */
    public async removeRolePermission(role: string, action: string, operation: string, domain: string = defaultDomain): Promise<boolean> {
        return (await this.enforcer.removePolicy(role, domain, action, operation)) && (await this.enforcer.savePolicy())
    }

    /**
     * 获取角色权限列表
     * @param role
     */
    public async listRolePermission(role: string): Promise<IPermission[]> {
        const rawPermissions: string[][] = await this.enforcer.getPermissionsForUser(role)
        return rawPermissions.map((rawPermission: string[]) => ({
            action: rawPermission[2],
            operation: rawPermission[3],
            domain: rawPermission[1]
        }))
    }
}
