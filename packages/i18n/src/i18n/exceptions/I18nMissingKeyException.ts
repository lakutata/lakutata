import {Exception} from '@lakutata/core'

export class I18nMissingKeyException extends Exception {
    public errno: string | number = 'E_I18N_MISSING_KEY'
}
