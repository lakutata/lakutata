/**
 * The pattern identifying an action: an object of key/value pairs (`{cmd: 'user.create'}`), declared by a
 * `@ServiceAction` (or the action decorator of another channel) and matched against the incoming messages. The type
 * parameter types its known keys; any other key is allowed.
 */
export type ActionPattern<T extends Record<string, any> = {}> = Record<string, any> & T
