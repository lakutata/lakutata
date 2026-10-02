import {Exception} from '@lakutata/core'

export class I18nTranslatorException extends Exception {
    public errno: string | number = 'E_I18N_TRANSLATOR'
}
