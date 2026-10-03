import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {ContainerdRegistryAuthOptions} from '../ContainerdRegistryAuthOptions.js'
import type {ContainerdProgressCallback} from '../../types/ContainerdProgressCallback.js'

export class ImagePullOptions extends DTO {
    /**
     * The reference of the image (alpine, alpine:3.20, registry.example.com:5000/app@sha256:…)
     */
    @Expect(DTO.String().required())
    public image: string

    /**
     * The platforms pulled (linux/arm64, linux/arm/v7), all of them with "all": the one of the machine by default
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String()).min(1)).optional())
    public platform?: string | string[]

    /**
     * The credentials of the registry, the ones of the component by default
     */
    @Expect(ContainerdRegistryAuthOptions.optional())
    public auth?: ContainerdRegistryAuthOptions

    /**
     * Unpack its layers into the snapshots of the platforms the machine runs
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public unpack?: boolean

    /**
     * The progress of the transfers of its layers
     */
    @Expect(DTO.Function().optional())
    public progressCallback?: ContainerdProgressCallback
}
