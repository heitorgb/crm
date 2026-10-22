import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DATE_ONLY_PATTERN } from '../../../common/dates/date-only.js';
import { PaginationQueryDto } from '../../../common/http/pagination.js';

export const CONTACT_SORT_FIELDS = ['createdAt', 'updatedAt', 'name'] as const;

export type ContactSortField = (typeof CONTACT_SORT_FIELDS)[number];

export class CreateContactDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'birthDate deve estar no formato YYYY-MM-DD' })
  birthDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  position?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsBoolean()
  isBlocked?: boolean;
}

export class UpdateContactDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'birthDate deve estar no formato YYYY-MM-DD' })
  birthDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  position?: string | null;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsBoolean()
  isBlocked?: boolean;
}

export class ListContactsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsIn(CONTACT_SORT_FIELDS)
  sort: ContactSortField = 'createdAt';
}

export class ResolveContactDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}
