import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {Stream} from 'node:stream'

/**
 * What {@link ContainerdContainer.exportDirectory} archives (as tar) and where. A running container is read through
 * its process root (its mounts included), a stopped one from its snapshot (its image layers and its changes, without
 * its mounts). The directories, regular files and symbolic links are archived with their modes, owners and times; the
 * devices, sockets and pipes are skipped. Both fields are required.
 * @example
 * ```typescript
 * import {createWriteStream} from 'node:fs'
 * import {Containerd} from 'lakutata/com/containerd'
 *
 * declare const containerd: Containerd
 *
 * const container = await containerd.getContainer('web')
 * //Into a file
 * await container.exportDirectory({path: '/etc/nginx', destination: '/tmp/nginx-config.tar'})
 * //Into a stream
 * await container.exportDirectory({path: '/var/log/nginx', destination: createWriteStream('/tmp/nginx-logs.tar')})
 * ```
 */
export class ContainerExportDirectoryOptions extends DTO {
    /**
     * The absolute path in the container of the directory or file archived, its symbolic links resolved in the
     * container; it is the archive's top entry, named by its base name. A missing path fails the export.
     */
    @Expect(DTO.String().required())
    public path: string

    /**
     * Where the tar archive is written: the path of a host file (created or replaced), or a writable stream, ended
     * once the archive is written.
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.InstanceOf(Stream)).required())
    public destination: string | NodeJS.WritableStream
}
