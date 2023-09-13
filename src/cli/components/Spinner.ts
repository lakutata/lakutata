import {Component, Configurable, Singleton} from '../../Lakutata'
import {Spinner as CliSpinner, dots} from 'cli-spinners'
import logUpdate from 'log-update'

@Singleton()
export class Spinner extends Component {

    @Configurable()
    protected readonly style: CliSpinner = dots

    protected spinnerInterval: NodeJS.Timer | null = null

    /**
     * 开启spinner
     * @param description
     */
    public start(description?: string): void {
        this.stop()
        let i: number = 0
        this.spinnerInterval = setInterval(() => {
            const {frames} = this.style
            const text: string = description ? `${frames[i = ++i % frames.length]} ${description}` : frames[i = ++i % frames.length]
            logUpdate(text)
        }, dots.interval)
    }

    /**
     * 关闭spinner
     */
    public stop(): void {
        if (this.spinnerInterval) {
            clearInterval(this.spinnerInterval)
            this.spinnerInterval = null
            logUpdate.clear()
        }
    }
}
