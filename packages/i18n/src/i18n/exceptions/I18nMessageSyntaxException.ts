import {Exception} from '@lakutata/core'

export class I18nMessageSyntaxException extends Exception {
    public errno: string | number = 'E_I18N_MESSAGE_SYNTAX'
}
