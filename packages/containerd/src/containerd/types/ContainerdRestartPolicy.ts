/**
 * The restart policy of a container ({@link ContainerCreateOptions.restartPolicy}), applied by containerd's restart
 * monitor (its `io.containerd.internal.v1.restart` plugin, which checks the containers periodically, every 10 seconds
 * by default), so it works without the application running:
 * - `''` or `'no'`: never restart it;
 * - `'always'`: restart it whenever it stops, until it is stopped through the component (`stop()`, `kill()` with
 *   `SIGKILL`, `remove()`);
 * - `'unless-stopped'`: the same as `'always'` with this component, which stops a container the same way for both;
 * - `'on-failure'`: restart it when it exits with a non-zero code; `'on-failure:N'` at most N times.
 *
 * Unlike the Docker component's policy, `'on-failure:N'` is accepted.
 */
export type ContainerdRestartPolicy = '' | 'no' | 'always' | 'unless-stopped' | 'on-failure' | `on-failure:${number}`
