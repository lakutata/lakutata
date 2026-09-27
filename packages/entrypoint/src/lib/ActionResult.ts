/**
 * The base of the results an action can return to describe its output beyond its data (status, headers, files, streams…),
 * the adapters output the results they support and the data of the others
 */
export abstract class ActionResult {

    /**
     * The data of the result
     */
    public abstract get data(): unknown
}
