import {type DockerRegistryAuth} from '../../client/DockerClient.js'
import {type DockerAuthOptions} from '../options/auth/DockerAuthOptions.js'

/**
 * The registry credentials sent to the daemon (the login, the pulls, the pushes and the builds), the tokens included
 * @param auth
 */
export function RegistryAuth(auth: DockerAuthOptions): DockerRegistryAuth
export function RegistryAuth(auth?: DockerAuthOptions): DockerRegistryAuth | undefined
export function RegistryAuth(auth?: DockerAuthOptions): DockerRegistryAuth | undefined {
    if (!auth) return undefined
    return {
        username: auth.username,
        password: auth.password,
        serveraddress: auth.serverAddress,
        email: auth.email,
        identitytoken: auth.identityToken,
        registrytoken: auth.registryToken
    }
}
