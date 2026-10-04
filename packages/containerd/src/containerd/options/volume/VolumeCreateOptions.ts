import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * A named volume {@link Containerd.createVolume} creates: an empty directory of the component's data root
 * (`<dataRoot>/volumes/<namespace>/<name>/_data`), which containers mount by {@link ContainerCreateOptions.volumes}.
 * It is not a nerdctl volume. When the volume exists, it is returned unchanged (its labels kept), as Docker does. Only
 * `name` is required.
 * @example
 * ```typescript
 * import {Containerd} from 'lakutata/com/containerd'
 *
 * declare const containerd: Containerd
 *
 * const volume = await containerd.createVolume({name: 'pgdata', labels: {project: 'shop'}})
 * await containerd.createContainer({image: 'postgres:16', volumes: [{volumeName: volume.name, containerPath: '/var/lib/postgresql/data'}]})
 * ```
 */
export class VolumeCreateOptions extends DTO {
    /**
     * The name of the volume, matching `[a-zA-Z0-9][a-zA-Z0-9_.-]*`. Required.
     */
    @Expect(DTO.String().pattern(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/).required())
    public name: string

    /**
     * The labels of the volume, kept with it ({@link ContainerdVolumeInfo.labels}); ignored when it exists.
     */
    @Expect(DTO.Object().pattern(DTO.String(), DTO.String().allow('')).optional())
    public labels?: Record<string, string>
}
