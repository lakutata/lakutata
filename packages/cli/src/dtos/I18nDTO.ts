import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class I18nDTO extends DTO {
    @Expect(DTO.String().valid('check', 'types', 'add').required().description('check: the problems of the messages of the languages; types: the declaration of the keys of the messages and of their arguments; add <locale>: the messages of a new language, made from the ones of the default language'))
    public action: 'check' | 'types' | 'add'

    @Expect(DTO.String().optional().description('The language added (add): zh-CN, ja, pt-BR'))
    public locale?: string

    @Expect(DTO.String().optional().default('locales').description('The directory of the messages: a file (zh-CN.json) or a directory (zh-CN/) by language; several separated by commas'))
    public dir: string

    @Expect(DTO.String().optional().default('en').description('The default language: the messages the other ones are checked against, the declaration is made of, a new language is made from'))
    public default: string

    @Expect(DTO.String().optional().default('src/i18n.d.ts').description('The file of the declaration (types)'))
    public out: string

    @Expect(DTO.String().optional().default('lakutata/com/i18n').description('The module the application imports the i18n from (types): lakutata/com/i18n, or @lakutata/i18n'))
    public module: string

    @Expect(DTO.Boolean().optional().default(false).description('The warnings fail the check too (check)'))
    public strict: boolean
}
