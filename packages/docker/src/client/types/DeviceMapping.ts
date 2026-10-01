/**
 * A device of the host mapped into a container in the Docker Engine API (DeviceMapping)
 */
export type DeviceMapping = {
    PathOnHost: string
    PathInContainer: string
    CgroupPermissions: string
}
