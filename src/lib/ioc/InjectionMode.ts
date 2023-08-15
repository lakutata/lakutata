/**
 * 注入模式类型
 */
export type InjectionModeType = 'PROXY' | 'CLASSIC'

/**
 * 解析模式
 */
export const InjectionMode: Record<InjectionModeType, InjectionModeType> = {
    /**
     * 依赖项将通过注入摇篮代理来解析
     */
    PROXY: 'PROXY',

    /**
     * 依赖项将通过检查函数/构造函数的参数名称来解析
     */
    CLASSIC: 'CLASSIC'
}
