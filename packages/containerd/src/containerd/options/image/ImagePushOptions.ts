import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {ContainerdRegistryAuthOptions} from '../ContainerdRegistryAuthOptions.js'
import type {ContainerdProgressCallback} from '../../types/ContainerdProgressCallback.js'

export class ImagePushOptions extends DTO {
    /**
     * The reference pushed to (registry.example.com/app:1.0), the name of the image by default
     */
    @Expect(DTO.String().optional())
    public reference?: string

    /**
     * The platform pushed when the image has not all the platforms of its index: the one of the machine by default
     */
    @Expect(DTO.String().optional())
    public platform?: string

    /**
     * The credentials of the registry, the ones of the component by default
     */
    @Expect(ContainerdRegistryAuthOptions.optional())
    public auth?: ContainerdRegistryAuthOptions

    /**
     * The progress of the transfers of its blobs
     */
    @Expect(DTO.Function().optional())
    public progressCallback?: ContainerdProgressCallback
}
