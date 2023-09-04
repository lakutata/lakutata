## How to Use

    import {Time} from 'lakutata

## Description

A class representing a time. Extends Date.

## Methods

#### Method: `constructor`

Constructor.

##### Parameters

- **`inp`** (TimeInput): Optional. The input time.

#### Method: `static timezones`

Get an array of all timezone names.

##### Return Value

- string[]: An array of timezone names.

#### Method: `static max`

Get the maximum value of a list of times.

##### Parameters

- **`times`** (Time[]): The list of times.

##### Return Value

- Time: The maximum time.

#### Method: `static min`

Get the minimum value of a list of times.

##### Parameters

- **`times`** (Time[]): The list of times.

##### Return Value

- Time: The minimum time.

#### Method: `updateTimestamp`

Update the internal timestamp of the current instance and return the updated instance.

##### Parameters

- **`time`** (number): The new timestamp value.

##### Return Value

- this: The updated instance of the time.

#### Method: `getTimezoneOffset`

Get the timezone offset.

##### Return Value

- number: The timezone offset.

#### Method: `timezone`

Get or set the timezone.

##### Parameters

- **`tz`** (string): Optional. The timezone to set.

##### Return Value

- string | undefined | this: If no parameter is given, the current timezone is returned. If a parameter is given, the timezone is set and the current instance is returned.

#### Method: `milliseconds`

Get or set the milliseconds.

##### Parameters

- **`value`** (number): Optional. The new value to set.

##### Return Value

- number | this: If no parameter is given, the current milliseconds value is returned. If a parameter is given, the milliseconds value is set and the current instance is returned.

#### Method: `seconds`

Get or set the seconds.

##### Parameters

- **`value`** (number): Optional. The new value to set.

##### Return Value

- number | this: If no parameter is given, the current seconds value is returned. If a parameter is given, the seconds value is set and the current instance is returned.

#### Method: `minutes`

Get or set the minutes.

##### Parameters

- **`value`** (number): Optional. The new value to set.

##### Return Value

- number | this: If no parameter is given, the current minutes value is returned. If a parameter is given, the minutes value is set and the current instance is returned.

#### Method: `hours`

Get or set the hours.

##### Parameters

- **`value`** (number): Optional. The new value to set.

##### Return Value

- number | this: If no parameter is given, the current hours value is returned. If a parameter is given, the hours value is set and the current instance is returned.

#### Method: `date`

Get or set the date.

##### Parameters

- **`value`** (number): Optional. The new value to set.

##### Return Value

- number | this: If no parameter is given, the current date value is returned. If a parameter is given, the date value is set and the current instance is returned.

#### Method: `weekday`

Get or set the weekday.

##### Parameters

- **`value`** (number): Optional. The new value to set.

##### Return Value

- number | this: If no parameter is given, the current weekday value is returned. If a parameter is given, the weekday value is set and the current instance is returned.

#### Method: `isoWeekday`

Get or set the ISO weekday.

##### Parameters

- **`value`** (number): Optional. The new value to set.

##### Return Value

- number | this: If no parameter is given, the current ISO weekday value is returned. If a parameter is given, the ISO weekday value is set and the current instance is returned.

#### Method: `dayOfYear`

Get or set the day of the year.

##### Parameters

- **`value`** (number): Optional. The new value to set.

##### Return Value

- number | this: If no parameter is given, the current day of the year value is returned. If a parameter is given, the day of the year value is set and the current instance is returned.

#### Method: `weeks`

Get or set the weeks.

##### Parameters

- **`value`** (number): Optional. The new value to set.

##### Return Value

- number | this: If no parameter is given, the current weeks value is returned. If a parameter is given, the weeks value is set and the current instance is returned.

#### Method: `isoWeeks`

Get or set the ISO weeks.

##### Parameters

- **`value`** (number): Optional. The new value to set.

##### Return Value

- number | this: If no parameter is given, the current ISO weeks value is returned. If a parameter is given, the ISO weeks value is set and the current instance is returned.

#### Method: `month`

Get or set the month.

##### Parameters

- **`value`** (number): Optional. The new value to set.

##### Return Value

- number | this: If no parameter is given, the current month value is returned. If a parameter is given, the month value is set and the current instance is returned.

#### Method: `quarters`

Get or set the quarters.

##### Parameters

- **`value`** (number): Optional. The new value to set.

##### Return Value

- number | this: If no parameter is given, the current quarters value is returned. If a parameter is given, the quarters value is set and the current instance is returned.

#### Method: `year`

Get or set the year.

##### Parameters

- **`value`** (number): Optional. The new value to set.

##### Return Value

- number | this: If no parameter is given, the current year value is returned. If a parameter is given, the year value is set and the current instance is returned.

#### Method: `isoWeekYear`

Get or set the ISO week year.

##### Parameters

- **`value`** (number): Optional. The new value to set.

##### Return Value

- number | this: If no parameter is given, the current ISO week year value is returned. If a parameter is given, the ISO week year value is set and the current instance is returned.

#### Method: `weeksInYear`

Get the number of weeks in the year.

##### Return Value

- number: The number of weeks in the year.

#### Method: `isoWeeksInYear`

Get the number of ISO weeks in the year.

##### Return Value

- number: The number of ISO weeks in the year.

#### Method: `get`

Get the value of a unit of time.

##### Parameters

- **`unit`** (UnitOfTime.All): The unit of time.

##### Return Value

- number: The value of the unit of time.

#### Method: `set`

Set the value of a unit of time.

##### Parameters

- **`unit`** (UnitOfTime.All): The unit of time.
- **`value`** (number): The value to set.

##### Return Value

- this: The updated instance of the time.

#### Method: `add`

Add a duration of time.

##### Parameters

- **`amount`** (number): The amount of time to add.
- **`unit`** (UnitOfTime.DurationConstructor): The unit of time.

##### Return Value

- this: The updated instance of the time.

#### Method: `subtract`

Subtract a duration of time.

##### Parameters

- **`amount`** (number): The amount of time to subtract.
- **`unit`** (UnitOfTime.DurationConstructor): The unit of time.

##### Return Value

- this: The updated instance of the time.

#### Method: `startOf`

Set the time to the start of a unit of time.

##### Parameters

- **`unit`** (UnitOfTime.StartOf): The unit of time.

##### Return Value

- this: The updated instance of the time.

#### Method: `endOf`

Set the time to the end of a unit of time.

##### Parameters

- **`unit`** (UnitOfTime.StartOf): The unit of time.

##### Return Value

- this: The updated instance of the time.

#### Method: `format`

Format the time as a string.

##### Parameters

- **`format`** (string): Optional. The format string.

##### Return Value

- string: The formatted time string.

#### Method: `diff`

Get the difference between two times.

##### Parameters

- **`inp`** (TimeInput): The other time to compare to.
- **`unit`** (UnitOfTime.Diff): Optional. The unit of time to return the difference in.
- **`precise`** (boolean): Optional. Whether to show a precise difference.

##### Return Value

- number: The difference between the two times.

#### Method: `unix`

Get the time as a Unix timestamp.

##### Return Value

- number: The Unix timestamp.

#### Method: `daysInMonth`

Get the number of days in the current month.

##### Return Value

- number: The number of days in the month.

#### Method: `toArray`

Get the time as an array.

##### Return Value

- [number, number, number, number, number, number, number]: The time as an array.

#### Method: `toObject`

Get the time as an object.

##### Return Value

- TimeObject: The time as an object.

#### Method: `toString`

Get the time as a string.

##### Return Value

- string: The time as a string.

#### Method: `toTimeString`

Get the time as a string.

##### Return Value

- string: The time as a string.

#### Method: `toUTCString`

Get the time as a UTC string.

##### Return Value

- string: The UTC string representing the time.

#### Method: `toDateString`

Get the time as a date string.

##### Return Value

- string: The date string representing the time.

#### Method: `toISOString`

Get the time as an ISO string.

##### Return Value

- string: The ISO string representing the time.

#### Method: `isBefore`

Check if the time is before another time.

##### Parameters

- **`inp`** (TimeInput): The other time to compare to.
- **`granularity`** (UnitOfTime.StartOf): Optional. The granularity of the check.

##### Return Value

- boolean: Whether the time is before the other time.

#### Method: `isSame`

Check if the time is the same as another time.

##### Parameters

- **`inp`** (TimeInput): The other time to compare to.
- **`granularity`** (UnitOfTime.StartOf): Optional. The granularity of the check.

##### Return Value

- boolean: Whether the time is the same as the other time.

#### Method: `isAfter`

Check if the time is after another time.

##### Parameters

- **`inp`** (TimeInput): The other time to compare to.
- **`granularity`** (UnitOfTime.StartOf): Optional. The granularity of the check.

##### Return Value

- boolean: Whether the time is after the other time.

#### Method: `isSameOrBefore`

Check if the time is the same as or before another time.

##### Parameters

- **`inp`** (TimeInput): The other time to compare to.
- **`granularity`** (UnitOfTime.StartOf): Optional. The granularity of the check.

##### Return Value

- boolean: Whether the time is the same as or before the other time.

#### Method: `isSameOrAfter`

Check if the time is the same as or after another time.

##### Parameters

- **`inp`** (TimeInput): The other time to compare to.
- **`granularity`** (UnitOfTime.StartOf): Optional. The granularity of the check.

##### Return Value

- boolean: Whether the time is the same as or after the other time.

#### Method: `isBetween`

Check if the time is between two other times.

##### Parameters

- **`a`** (TimeInput): The start time to compare to.
- **`b`** (TimeInput): The end time to compare to.
- **`granularity`** (UnitOfTime.StartOf): Optional. The granularity of the check.
- **`inclusivity`** ('()' | '[)' | '(]' | '[]'): Optional. The inclusivity of the check.

##### Return Value

- boolean: Whether the time is between the two other times.

#### Method: `isLeapYear`

Check if the year of the time is a leap year.

##### Return Value

- boolean: Whether the year is a leap year.

#### Method: `clone`

Clone the current instance of the time.

##### Return Value

- Time: The cloned instance of the time.
