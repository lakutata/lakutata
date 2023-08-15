import 'reflect-metadata'

/**
 * 生命周期类型
 */
export type LifetimeType = 'SINGLETON' | 'TRANSIENT' | 'SCOPED'

/**
 * 生命周期类型
 */
export const Lifetime: Record<LifetimeType, LifetimeType> = {
    /**
     * 注册项将会被解析一次且仅一次
     */
    SINGLETON: 'SINGLETON',
    /**
     * 注册项每次都会被解析(不会缓存)
     */
    TRANSIENT: 'TRANSIENT',
    /**
     * 注册项将在每个作用域中解析一次
     */
    SCOPED: 'SCOPED'
}
