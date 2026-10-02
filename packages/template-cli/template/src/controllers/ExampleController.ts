import {Controller} from 'lakutata/com/entrypoint'
import {CLIAction} from 'lakutata/decorator/ctrl'
import {GreetDTO} from '../dtos/GreetDTO.js'
//@if i18n
import {Inject} from 'lakutata/decorator/di'
import {Translator} from 'lakutata/com/i18n'
//@end

export class ExampleController extends Controller {
    //@if i18n

    /**
     * The messages of the language of the request
     */
    @Inject(Translator)
    protected readonly i18n: Translator
    //@end

    /**
     * {$APP_ID} greet --name you: the result is printed
     * @param input
     */
    @CLIAction('greet', GreetDTO, {description: 'Greet someone'})
    public async greet(input: GreetDTO): Promise<string> {
        //@if i18n
        const greeting: string = this.i18n.t('greeting.hello', {name: input.name})
        //@else
        const greeting: string = `Hello, ${input.name}!`
        //@end
        return Array(input.times).fill(input.loud ? greeting.toUpperCase() : greeting).join('\n')
    }
}
