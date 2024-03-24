import {ICType} from '../interfaces/ICType.js'

export type LibFunc<T extends (...args: any) => any> = T & {
    async: (...args: [...Parameters<T>, (err: any, result: ReturnType<T>) => void]) => void;
    info: {
        name: string;
        arguments: ICType[];
        result: ICType;
    };
};
