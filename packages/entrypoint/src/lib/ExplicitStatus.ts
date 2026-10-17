import type {ServerResponse} from 'node:http'

/**
 * The responses whose status was set by the action (a StatusResult): the default responders keep it, 200 included
 */
const explicitStatuses: WeakSet<ServerResponse> = new WeakSet()

/**
 * Mark the status of a response as set by the action
 * @param response
 */
export function markExplicitStatus(response: ServerResponse): void {
    explicitStatuses.add(response)
}

/**
 * Whether the status of a response was set by the action
 * @param response
 */
export function hasExplicitStatus(response: ServerResponse): boolean {
    return explicitStatuses.has(response)
}
