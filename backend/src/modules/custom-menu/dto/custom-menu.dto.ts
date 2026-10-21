import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  CUSTOM_MENU_ICON_KEYS,
  MAX_CUSTOM_MENU_BUTTONS_PER_GROUP,
  MAX_CUSTOM_MENU_GROUPS,
} from '../custom-menu.constants.js';

const URL_VALIDATION_OPTIONS = {
  protocols: ['http', 'https'],
  require_protocol: true,
  require_tld: false,
};

function trimmed(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CustomMenuButtonPayloadDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/\S/, { message: 'name must not be blank' })
  name!: string;

  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MaxLength(2048)
  @IsUrl(URL_VALIDATION_OPTIONS, { message: 'url must be a valid http or https URL' })
  url!: string;

  @IsOptional()
  @IsIn(CUSTOM_MENU_ICON_KEYS)
  icon?: string | null;

  @IsOptional()
  @IsBoolean()
  active: boolean = true;
}

export class CustomMenuGroupPayloadDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/\S/, { message: 'name must not be blank' })
  name!: string;

  @IsOptional()
  @IsIn(CUSTOM_MENU_ICON_KEYS)
  icon?: string | null;

  @IsOptional()
  @IsBoolean()
  active: boolean = true;

  @IsArray()
  @ArrayMaxSize(MAX_CUSTOM_MENU_BUTTONS_PER_GROUP)
  @ValidateNested({ each: true })
  @Type(() => CustomMenuButtonPayloadDto)
  buttons: CustomMenuButtonPayloadDto[] = [];
}

export class SaveCustomMenuDto {
  @IsArray()
  @ArrayMaxSize(MAX_CUSTOM_MENU_GROUPS)
  @ValidateNested({ each: true })
  @Type(() => CustomMenuGroupPayloadDto)
  groups!: CustomMenuGroupPayloadDto[];
}

export class CreateCustomMenuGroupDto {
  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/\S/, { message: 'name must not be blank' })
  name!: string;

  @IsOptional()
  @IsIn(CUSTOM_MENU_ICON_KEYS)
  icon?: string | null;

  @IsOptional()
  @IsBoolean()
  active: boolean = true;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CUSTOM_MENU_BUTTONS_PER_GROUP)
  @ValidateNested({ each: true })
  @Type(() => CustomMenuButtonPayloadDto)
  buttons?: CustomMenuButtonPayloadDto[];
}

export class UpdateCustomMenuGroupDto {
  @IsOptional()
  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/\S/, { message: 'name must not be blank' })
  name?: string;

  @IsOptional()
  @IsIn(CUSTOM_MENU_ICON_KEYS)
  icon?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;
}

export class CreateCustomMenuButtonDto {
  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/\S/, { message: 'name must not be blank' })
  name!: string;

  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MaxLength(2048)
  @IsUrl(URL_VALIDATION_OPTIONS, { message: 'url must be a valid http or https URL' })
  url!: string;

  @IsOptional()
  @IsIn(CUSTOM_MENU_ICON_KEYS)
  icon?: string | null;

  @IsOptional()
  @IsBoolean()
  active: boolean = true;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;
}

export class UpdateCustomMenuButtonDto {
  @IsOptional()
  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/\S/, { message: 'name must not be blank' })
  name?: string;

  @IsOptional()
  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MaxLength(2048)
  @IsUrl(URL_VALIDATION_OPTIONS, { message: 'url must be a valid http or https URL' })
  url?: string;

  @IsOptional()
  @IsIn(CUSTOM_MENU_ICON_KEYS)
  icon?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;
}
