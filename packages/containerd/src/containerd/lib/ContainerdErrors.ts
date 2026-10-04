import {InvalidValueException} from '@lakutata/core'
import {ContainerdImageNotFoundException} from '../exceptions/ContainerdImageNotFoundException.js'
import {ContainerdPlatformException} from '../exceptions/ContainerdPlatformException.js'
import {ContainerdContainerNameConflictException} from '../exceptions/ContainerdContainerNameConflictException.js'
import {ContainerdContainerStateException} from '../exceptions/ContainerdContainerStateException.js'
import {ContainerdNetworkNotFoundException} from '../exceptions/ContainerdNetworkNotFoundException.js'
import {ContainerdPathNotFoundException} from '../exceptions/ContainerdPathNotFoundException.js'

/**
 * The exception of an error of the client (by its code), or the one given
 * @param error
 * @param fallback the exception of the operation
 */
export function ContainerdError(error: unknown, fallback?: new (message: string) => Error): Error {
    const message: string = (error as Error)?.message ?? String(error)
    switch ((error as { code?: unknown })?.code) {
        case 'NOT_FOUND':
            return new ContainerdImageNotFoundException(message)
        case 'PLATFORM':
            return new ContainerdPlatformException(message)
        case 'CONFLICT':
            return new ContainerdContainerNameConflictException(message)
        case 'NETWORK_NOT_FOUND':
            return new ContainerdNetworkNotFoundException(message)
        case 'INVALID_VALUE':
            return new InvalidValueException(message)
        case 'PATH_NOT_FOUND':
            return new ContainerdPathNotFoundException(message)
        case 'RUNNING':
        case 'NOT_RUNNING':
        case 'PAUSED':
            return new ContainerdContainerStateException(message)
    }
    return fallback ? new fallback(message) : error as Error
}
