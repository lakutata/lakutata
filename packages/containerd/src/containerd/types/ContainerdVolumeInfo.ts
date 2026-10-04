import type {Time} from '@lakutata/utils/Time'

/**
 * A named volume of the component ({@link Containerd.listVolumes}, {@link Containerd.getVolume},
 * {@link Containerd.createVolume}): a directory of the host in the component's data root, kept per containerd
 * namespace.
 */
export type ContainerdVolumeInfo = {
    /**
     * Its name.
     */
    name: string
    /**
     * The host directory holding its data and mounted into the containers:
     * `<dataRoot>/volumes/<namespace>/<name>/_data` (`/var/lib/lakutata/containerd/volumes/default/<name>/_data`
     * by default).
     */
    mountpoint: string
    /**
     * The labels it was created with.
     */
    labels: Record<string, string>
    /**
     * When it was created.
     */
    createdAt: Time
}
