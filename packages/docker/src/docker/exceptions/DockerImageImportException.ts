import {Exception} from '@lakutata/core'

/**
 * Thrown by {@link Docker.importImage} when the daemon rejects the archive (not an archive of `docker save`, a corrupted
 * archive), or when the image loaded cannot be known from the daemon's answer nor the archive's manifest. Its `errno` is
 * `E_DOCKER_IMAGE_IMPORT`.
 */
export class DockerImageImportException extends Exception {
    public errno: string | number = 'E_DOCKER_IMAGE_IMPORT'
}