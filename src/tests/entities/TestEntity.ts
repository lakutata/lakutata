import {Entity} from '../../decorators/orm/Entity.js'
import {BaseEntity} from '../../exports/ORM.js'
import {PrimaryGeneratedColumn} from '../../decorators/orm/PrimaryGeneratedColumn.js'
import {Column} from '../../decorators/orm/Column.js'
import {CreateDateColumn} from '../../decorators/orm/CreateDateColumn.js'

@Entity()
export class TestEntity extends BaseEntity {
    @PrimaryGeneratedColumn()
    public id:string

    @Column()
    public content:string

    @CreateDateColumn()
    public createdAt:Date
}