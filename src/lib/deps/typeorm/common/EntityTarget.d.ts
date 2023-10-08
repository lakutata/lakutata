import { ObjectType } from './ObjectType'
import { EntitySchema } from '../entity-schema/EntitySchema'
/**
 * Entity target.
 */
export type EntityTarget<Entity> = ObjectType<Entity> | EntitySchema<Entity> | string | {
    type: Entity;
    name: string;
};
