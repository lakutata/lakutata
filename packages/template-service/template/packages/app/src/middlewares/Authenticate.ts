import {Exception} from 'lakutata'
import type {ActionInvocation, HTTPContext, Next} from 'lakutata/com/entrypoint'

export class UnauthorizedException extends Exception {
    public errno: string = 'E_UNAUTHORIZED'

    public readonly statusCode: number = 401
}

/**
 * The requests carry "Authorization: Bearer <API_TOKEN>" when the environment has an API_TOKEN (the health check excepted).
 * Replace it with the authentication of the service (a session, a JWT verified with the keys of the identity provider…)
 * @param invocation
 * @param next
 */
export async function authenticate(invocation: ActionInvocation, next: Next): Promise<unknown> {
    const token: string | undefined = process.env.API_TOKEN
    const context: HTTPContext = invocation.context as HTTPContext
    if (!token || context.route === '/health') return next()
    if (context.request.headers.authorization !== `Bearer ${token}`) throw new UnauthorizedException('The request is not authenticated')
    return next()
}
