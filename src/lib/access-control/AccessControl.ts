import {IUser} from '../../interfaces/IUser'
import {Configurable, Transient} from '../../decorators/DependencyInjectionDecorators'
import {Enforcer} from 'casbin'
import {AuthStoreOptions} from '../../types/AuthStoreOptions'
import {Component} from '../base/Component'
import {NoAuthUserException} from '../../exceptions/auth/NoAuthUserException'
import {defaultDomain} from '../../constants/DefaultValue'
import {IPermission} from '../../interfaces/auth/IPermission'
import {EnforcerManager} from './EnforcerManager'

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
            if (!this.module.has(EnforcerManager)) await this.module.set(EnforcerManager, {
                store: this.store
            })
            const enforcerManager: EnforcerManager = await this.module.get(EnforcerManager)
            this.enforcer = enforcerManager.enforcer
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
     * 更新规则
     * @param fn
     * @protected
     */
    protected async updatePolicy<T>(fn: () => Promise<T>): Promise<T> {
        const result: T = await fn()
        await this.enforcer.savePolicy()
        return result
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
        return await this.updatePolicy(async (): Promise<boolean> => await this.enforcer.addPermissionForUser(this.user.id, domain, action, operation))
    }

    /**
     * 删除用户权限
     * @param action
     * @param operation
     * @param domain
     */
    @AuthUserRequired()
    public async removeUserPermission(action: string, operation: string, domain: string = defaultDomain): Promise<boolean> {
        return await this.updatePolicy(async (): Promise<boolean> => await this.enforcer.deletePermissionForUser(this.user.id, domain, action, operation))
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
        return await this.updatePolicy(async (): Promise<boolean> => await this.enforcer.addRoleForUser(this.user.id, role, domain))
    }

    /**
     * 删除用户角色
     * @param role
     * @param domain
     */
    @AuthUserRequired()
    public async removeRoleFromUser(role: string, domain: string = defaultDomain): Promise<boolean> {
        return await this.updatePolicy(async (): Promise<boolean> => await this.enforcer.deleteRoleForUser(this.user.id, role, domain))
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
        return await this.updatePolicy(async (): Promise<boolean> => await this.enforcer.deleteUser(this.user.id))
    }

    /**
     * 创建角色权限
     * @param role
     * @param action
     * @param operation
     * @param domain
     */
    public async createRolePermission(role: string, action: string, operation: string, domain: string = defaultDomain): Promise<boolean> {
        return await this.updatePolicy(async (): Promise<boolean> => await this.enforcer.addPolicy(role, domain, action, operation))
    }

    /**
     * 删除角色权限
     * @param role
     * @param action
     * @param operation
     * @param domain
     */
    public async removeRolePermission(role: string, action: string, operation: string, domain: string = defaultDomain): Promise<boolean> {
        return await this.updatePolicy(async (): Promise<boolean> => await this.enforcer.removePolicy(role, domain, action, operation))
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

    /**
     * 将父角色分配给子角色
     * @param childRole
     * @param parentRole
     * @param domain
     */
    public async assignRoleToRole(childRole: string, parentRole: string, domain: string = defaultDomain): Promise<boolean> {
        return await this.updatePolicy(async (): Promise<boolean> => await this.enforcer.addRoleForUser(childRole, parentRole, domain))
    }

    /**
     * 从子角色中移除父角色
     * @param childRole
     * @param parentRole
     * @param domain
     */
    public async removeRoleFromRole(childRole: string, parentRole: string, domain: string = defaultDomain): Promise<boolean> {
        return await this.updatePolicy(async (): Promise<boolean> => await this.enforcer.deleteRoleForUser(childRole, parentRole, domain))
    }

    /**
     * 清除角色所有权限信息
     * @param role
     */
    public async clearRoleInfo(role: string): Promise<boolean> {
        return await this.updatePolicy(async (): Promise<boolean> => await this.enforcer.deleteRole(role))
    }
}
