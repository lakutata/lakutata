/**
 * Registry of modules which upstream joi required lazily (inside functions) to keep its module load order.
 * The registered modules add themselves when they are loaded; users read them at runtime only.
 */
export const Lazy = {
    messages: undefined,
    schemas: undefined,
    template: undefined
};
