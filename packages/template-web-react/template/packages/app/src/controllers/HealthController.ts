import {Controller} from 'lakutata/com/entrypoint'
import {GET} from 'lakutata/decorator/ctrl'

export class HealthController extends Controller {

    /**
     * GET /health: the process answers
     */
    @GET('/health')
    public async health(): Promise<{ status: string }> {
        return {status: 'ok'}
    }
}
