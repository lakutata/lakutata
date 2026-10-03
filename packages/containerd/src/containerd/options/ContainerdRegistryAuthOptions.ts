import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The credentials of a registry
 */
export class ContainerdRegistryAuthOptions extends DTO {
    /**
     * The user of the registry
     */
    @Expect(DTO.String().optional())
    public username?: string

    /**
     * Its password (or its access token)
     */
    @Expect(DTO.String().optional())
    public password?: string

    /**
     * An identity token (the refresh token of OAuth2 of the registry), instead of the user and its password
     */
    @Expect(DTO.String().optional())
    public identityToken?: string
}
