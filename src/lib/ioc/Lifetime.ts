/**
 * Lifetime type.
 */
export type LifetimeType = 'APPLICATION_SINGLETON' | 'MODULE_SINGLETON' | 'SINGLETON' | 'TRANSIENT' | 'SCOPED'

/**
 * Lifetime types.
 */
export const Lifetime: Record<LifetimeType, LifetimeType> = {
    /**
     * The registration will be resolved once and only once in current application.
     * @type {String}
     */
    APPLICATION_SINGLETON: 'APPLICATION_SINGLETON',

    /**
     * The registration will be resolved once and only once in current module.
     * @type {String}
     */
    MODULE_SINGLETON: 'MODULE_SINGLETON',

    /**
     * Alias for MODULE_SINGLETON
     * @type {String}
     */
    SINGLETON: 'SINGLETON',

    /**
     * The registration will be resolved every time (never cached).
     * @type {String}
     */
    TRANSIENT: 'TRANSIENT',

    /**
     * The registration will be resolved once per scope.
     * @type {String}
     */
    SCOPED: 'SCOPED'
}

/**
 * Returns true if and only if the first lifetime is strictly longer than the second.
 */
export function isLifetimeLonger(a: LifetimeType, b: LifetimeType): boolean {
    const alt: LifetimeType = a === 'SINGLETON' ? 'MODULE_SINGLETON' : a
    const blt: LifetimeType = b === 'SINGLETON' ? 'MODULE_SINGLETON' : b
    return (
        (alt === Lifetime.APPLICATION_SINGLETON && blt !== Lifetime.APPLICATION_SINGLETON) ||
        (alt === Lifetime.MODULE_SINGLETON && blt === Lifetime.SCOPED) ||
        (alt === Lifetime.MODULE_SINGLETON && blt === Lifetime.TRANSIENT) ||
        (alt === Lifetime.SCOPED && blt === Lifetime.TRANSIENT)
    )
}
