import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The credentials of an image registry: checked by {@link Docker.loginRepository} and
 * {@link Docker.checkRepositoryAuth}, and sent with the image pulls ({@link ImagePullOptions.auth}), pushes
 * ({@link ImagePushOptions.auth}) and builds ({@link ImageBuildOptions.auth}), each of them given every field set
 * (the tokens included). Only `serverAddress` is required.
 * @example
 * ```typescript
 * import {Docker} from 'lakutata/com/docker'
 *
 * declare const docker: Docker
 *
 * const valid: boolean = await docker.checkRepositoryAuth({
 *     serverAddress: 'registry.example.com:5000',
 *     username: 'ci',
 *     password: process.env.REGISTRY_PASSWORD ?? ''
 * })
 * ```
 */
export class DockerAuthOptions extends DTO {
    /**
     * The user name.
     */
    @Expect(DTO.String().optional())
    public username?: string

    /**
     * The password, or a personal access token of the registry.
     */
    @Expect(DTO.String().optional())
    public password?: string

    /**
     * The registry address, a host name or an IP address with its port when it is not the default one, without a
     * protocol (`registry.example.com`, `10.0.0.5:5000`). Required.
     */
    @Expect(DTO.String().required())
    public serverAddress: string

    /**
     * The e-mail address of the account, for the old registries asking for it; the current ones ignore it.
     */
    @Expect(DTO.String().optional())
    public email?: string | undefined

    /**
     * An identity token (an OAuth refresh token) the registry gave at a previous login, used instead of the password.
     */
    @Expect(DTO.String().optional())
    public identityToken?: string | undefined

    /**
     * A bearer token the registry gave, used instead of the user name and the password.
     */
    @Expect(DTO.String().optional())
    public registryToken?: string | undefined
}
