import {Component, Configurable} from '../../Lakutata'
import degit from 'degit'

export class DeGitPuller extends Component {

    @Configurable()
    protected readonly cache: boolean = false

    @Configurable()
    protected readonly verbose: boolean = true

    @Configurable()
    protected readonly force: boolean = true

    @Configurable()
    protected readonly repo: string

    /**
     * 获取git源
     * @param branch
     * @protected
     */
    protected getGitSource(branch: string): string {
        return `${this.repo}#${branch}`
    }

    /**
     * 执行拉取
     * @param branch
     * @param localTarget
     * @protected
     */
    protected async pull(branch: string, localTarget: string): Promise<void> {
        await degit(this.getGitSource(branch), {
            cache: this.cache,
            verbose: this.verbose,
            force: this.force
        }).clone(localTarget)
    }

    public async createProject(){}

    public async initProject(){}
}
