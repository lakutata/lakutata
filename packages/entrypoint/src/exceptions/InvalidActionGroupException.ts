import {Exception} from '@lakutata/core'

/**
 * An action is in a group that the `*ActionGroups` option of its channel (`httpActionGroups`, `cliActionGroups`,
 * `serviceActionGroups`) does not declare, when the entrypoint initializes. Its errno is `E_INVALID_ACTION_GROUP`.
 */
export class InvalidActionGroupException extends Exception {
    public errno: string | number = 'E_INVALID_ACTION_GROUP'
}