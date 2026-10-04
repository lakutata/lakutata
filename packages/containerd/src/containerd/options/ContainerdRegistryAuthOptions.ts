import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The credentials of a container registry, given to a pull, a push or a build (their `auth` option) for the registry
 * of the reference they name. They replace, for that operation, the ones the component's `registryAuths` option gives
 * that registry. Every field is optional; without `username` nor `identityToken`, the registry is accessed anonymously.
 * @example
 * ```typescript
 * import {Containerd} from 'lakutata/com/containerd'
 *
 * declare const containerd: Containerd
 *
 * await containerd.pullImage({
 *     image: 'registry.example.com:5000/team/app:1.0',
 *     auth: {username: 'ci', password: process.env.REGISTRY_TOKEN ?? ''}
 * })
 * ```
 */
export class ContainerdRegistryAuthOptions extends DTO {
    /**
     * The user name, sent with `password` (HTTP basic authentication, or the registry's token service).
     */
    @Expect(DTO.String().optional())
    public username?: string

    /**
     * The password of `username`, or an access token the registry accepts as one; ignored without `username`.
     */
    @Expect(DTO.String().optional())
    public password?: string

    /**
     * An identity token (the OAuth2 refresh token the registry issued, as `docker login` stores it), exchanged with the
     * registry's token service for an access token instead of `username` and `password`.
     */
    @Expect(DTO.String().optional())
    public identityToken?: string
}
