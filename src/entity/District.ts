import { Entity, PrimaryGeneratedColumn, Column, BaseEntity } from "typeorm";
import { IsString, IsInt } from "class-validator";

@Entity({ name: "districts" })
export class District extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  @IsString({ message: "Invalid Name" })
  name: string;

  @Column("text")
  area: string;

  @Column("bigint", { nullable: true })
  completionDate: string;

  @Column("text")
  image: string;

  @Column("text")
  map: string;

  @Column({ nullable: true })
  @IsInt({ message: "Invalid Parent" })
  parent: number;

  @Column("text")
  about: string;
}
