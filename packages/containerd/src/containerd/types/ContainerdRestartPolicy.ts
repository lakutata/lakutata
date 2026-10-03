/**
 * "" or "no" Do not automatically restart
 * "always" Always restart
 * "unless-stopped" Restart always except when the user has manually stopped the container
 * "on-failure" Restart only when the container exit code is non-zero ("on-failure:N" N times at most)
 */
export type ContainerdRestartPolicy = '' | 'no' | 'always' | 'unless-stopped' | 'on-failure' | `on-failure:${number}`
