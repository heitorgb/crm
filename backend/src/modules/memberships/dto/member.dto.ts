import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { Role } from '@prisma/client';

export const MEMBER_ROLES = ['OWNER', 'ADMIN', 'USER'] as const;

export class CreateMemberDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password?: string;

  @IsIn(MEMBER_ROLES)
  role!: Role;
}

export class UpdateMemberDto {
  @IsOptional()
  @IsIn(MEMBER_ROLES)
  role?: Role;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
