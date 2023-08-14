export namespace UnitOfTime {
    export type Base = (
        'year' | 'years' | 'y' |
        'month' | 'months' | 'M' |
        'week' | 'weeks' | 'w' |
        'day' | 'days' | 'd' |
        'hour' | 'hours' | 'h' |
        'minute' | 'minutes' | 'm' |
        'second' | 'seconds' | 's' |
        'millisecond' | 'milliseconds' | 'ms'
        );

    export type _quarter = 'quarter' | 'quarters' | 'Q';
    export type _isoWeek = 'isoWeek' | 'isoWeeks' | 'W';
    export type _date = 'date' | 'dates' | 'D';
    export type DurationConstructor = Base | _quarter;

    export type DurationAs = Base;

    export type StartOf = Base | _quarter | _isoWeek | _date | null;

    export type Diff = Base | _quarter;

    export type MomentConstructor = Base | _date;

    export type All = Base | _quarter | _isoWeek | _date |
        'weekYear' | 'weekYears' | 'gg' |
        'isoWeekYear' | 'isoWeekYears' | 'GG' |
        'dayOfYear' | 'dayOfYears' | 'DDD' |
        'weekday' | 'weekdays' | 'e' |
        'isoWeekday' | 'isoWeekdays' | 'E';
}
