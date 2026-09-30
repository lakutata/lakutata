import {Entity, PrimaryGeneratedColumn, Column, CreateDateColumn} from '@lakutata/orm/decorator/orm'
import {BaseEntity} from '@lakutata/orm'

@Entity()
export class TestEntity extends BaseEntity {
    @PrimaryGeneratedColumn()
    public id:string

    @Column()
    public content:string

    @CreateDateColumn()
    public createdAt:Date
}