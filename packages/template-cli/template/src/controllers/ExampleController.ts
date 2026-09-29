import {Controller} from 'lakutata/com/entrypoint'
import {CLIAction} from 'lakutata/decorator/ctrl'
import {GreetDTO} from '../dtos/GreetDTO.js'

export class ExampleController extends Controller {

    /**
     * {$APP_ID} greet --name you: the result is printed
     * @param input
     */
    @CLIAction('greet', GreetDTO, {description: 'Greet someone'})
    public async greet(input: GreetDTO): Promise<string> {
        const greeting: string = `Hello, ${input.name}!`
        return Array(input.times).fill(input.loud ? greeting.toUpperCase() : greeting).join('\n')
    }
}
