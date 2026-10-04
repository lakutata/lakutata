import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {Stream, Writable} from 'node:stream'

/**
 * What `DockerContainer.exportDirectory()` copies out of a container (`docker cp`): a file or directory of the
 * container, written as an uncompressed tar archive to a file or a stream. The container may be stopped.
 * @example
 * ```typescript
 * import {Docker} from 'lakutata/com/docker'
 *
 * declare const docker: Docker
 *
 * const container = await docker.getContainer('web')
 * await container.exportDirectory({path: '/var/log/nginx', destination: '/backup/nginx-logs.tar'})
 * ```
 */
export class ContainerExportDirectoryOptions extends DTO {
    /**
     * The absolute path of the file or directory in the container (`/var/log/nginx`); the archive holds it under its
     * base name (`nginx/…`). Required.
     */
    @Expect(DTO.String().required())
    public path: string

    /**
     * Where the tar archive is written: the path of a host file, created or replaced, or a writable stream, ended once
     * the archive is written. Required.
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.InstanceOf(Stream)).required())
    public destination: string | Writable
}
