import {Controller} from 'lakutata/com/entrypoint'
import {GET, Prefix} from 'lakutata/decorator/ctrl'
import {GreetDTO} from '../dtos/GreetDTO.js'

@Prefix({route: '/example'})
export class ExampleController extends Controller {

    /**
     * GET /example?name=you
     * @param input
     */
    @GET('/', GreetDTO)
    public async greet(input: GreetDTO): Promise<{ message: string }> {
        return {message: `Hello, ${input.name}!`}
    }
}
