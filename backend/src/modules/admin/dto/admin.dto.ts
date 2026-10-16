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
import { PaginationQueryDto } from '../../../common/http/pagination.js';

export const ADMIN_ROLES = ['OWNER', 'ADMIN', 'USER'] as const;

export class CreateTenantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  ownerName!: string;

  @IsEmail()
  @MaxLength(320)
  ownerEmail!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  ownerPassword!: string;
}

export class AddMemberDto {
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

  @IsIn(ADMIN_ROLES)
  role!: Role;
}

export class UpdateMemberDto {
  @IsOptional()
  @IsIn(ADMIN_ROLES)
  role?: Role;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateTenantModuleDto {
  @IsBoolean()
  enabled!: boolean;
}

export class ListTenantsQueryDto extends PaginationQueryDto {}

export class ListUsersQueryDto extends PaginationQueryDto {}
