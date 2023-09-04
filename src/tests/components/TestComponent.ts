import {Component, Scoped} from '../../Lakutata'

@Scoped()
export class TestComponent extends Component {
    /**
     * 初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
        this.log.info('I\'m %s in %s', this.className, this.module.className)
    }
}
