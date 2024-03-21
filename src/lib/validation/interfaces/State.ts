export interface State {
    key?: string;
    path?: (string | number)[];
    parent?: any;
    reference?: any;
    ancestors?: any;
    localize?(...args: any[]): State;
}
