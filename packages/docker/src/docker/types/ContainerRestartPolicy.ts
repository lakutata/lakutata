/**
 * When Docker restarts a container after it exits:
 * - `''`: never (no policy, the same as `'no'`);
 * - `'no'`: never;
 * - `'always'`: always, and when the Docker daemon starts, even if the container was stopped by hand;
 * - `'unless-stopped'`: always, except after the container was stopped by hand;
 * - `'on-failure'`: only when it exits with a non-zero code, with no limit on the retries;
 * - `'on-failure:N'` (`'on-failure:3'`): only when it exits with a non-zero code, `N` times at most (as
 *   `docker run --restart on-failure:3`).
 */
export type ContainerRestartPolicy = '' | 'no' | 'always' | 'unless-stopped' | 'on-failure' | `on-failure:${number}`
