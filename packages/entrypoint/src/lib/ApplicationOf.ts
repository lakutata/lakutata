import {Application} from '@lakutata/core'

/**
 * The application a module belongs to (undefined out of an application: a container of the tests)
 * @param module
 */
export function ApplicationOf(module: unknown): Application | undefined {
    let target: any = module
    while (target && !(target instanceof Application)) target = target.getParent?.()
    return target
}
