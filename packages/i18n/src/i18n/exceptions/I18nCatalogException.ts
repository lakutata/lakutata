import {Exception} from '@lakutata/core'

export class I18nCatalogException extends Exception {
    public errno: string | number = 'E_I18N_CATALOG'
}
