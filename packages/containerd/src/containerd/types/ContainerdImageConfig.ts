/**
 * The configuration an image gives its containers ({@link ContainerdImage.config}), read from the OCI image
 * configuration of the platform the image object describes. A {@link ContainerCreateOptions} overrides its fields.
 */
export type ContainerdImageConfig = {
    /**
     * Its environment variables by name (`{PATH: '/usr/local/sbin:…'}`).
     */
    env: Record<string, string>
    /**
     * Its default command (`CMD`), `[]` when it has none.
     */
    cmd: string[]
    /**
     * Its entry point (`ENTRYPOINT`), `[]` when it has none.
     */
    entrypoint: string[]
    /**
     * The working directory of its process (`WORKDIR`), `''` when it has none (`/` is used).
     */
    workingDir: string
    /**
     * The user of its process (`USER`: `user`, `user:group`, `uid`, `uid:gid`), `''` when it has none (root).
     */
    user: string
    /**
     * The ports it declares (`EXPOSE`), the protocol `'tcp'` when the image gives none. They are not published by
     * themselves: see {@link ContainerCreateOptions.ports}.
     */
    exposedPorts: { port: number, type: 'tcp' | 'udp' | 'sctp' }[]
    /**
     * The paths it declares as volumes (`VOLUME`). The component mounts no volume for them by itself.
     */
    volumes: string[]
    /**
     * The labels of its configuration (`LABEL`), copied to its containers.
     */
    labels: Record<string, string>
    /**
     * The signal stopping its containers (`STOPSIGNAL`: `'SIGQUIT'`), undefined when it has none (`SIGTERM` is used).
     */
    stopSignal?: string
}
