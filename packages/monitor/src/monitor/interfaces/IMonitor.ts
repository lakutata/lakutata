/**
 * A monitor: a component exposing the statistics of what it measures.
 * @typeParam T The type of its statistics.
 */
export interface IMonitor<T> {
    /**
     * The statistics of the measures, computed at each read.
     */
    statistics: T
}