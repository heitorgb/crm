import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AiFormality, AiProvider } from '@prisma/client';
import { AI_MAX_INPUT_CHARS } from '../ai.models.js';

function trimmed(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function trimmedOrUndefined(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const result = value.trim();
  return result.length > 0 ? result : undefined;
}

export class UpdateAiSettingsDto {
  @IsEnum(AiProvider)
  provider!: AiProvider;

  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  model!: string;

  @IsEnum(AiFormality)
  formality!: AiFormality;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Transform(({ value }) => trimmedOrUndefined(value))
  @IsString()
  @MaxLength(1024)
  apiKey?: string;

  @IsOptional()
  @IsBoolean()
  clearCredentials?: boolean;
}

export class UpdateAiCredentialDto {
  @IsOptional()
  @Transform(({ value }) => trimmedOrUndefined(value))
  @IsString()
  @MaxLength(1024)
  apiKey?: string;

  @IsOptional()
  @IsBoolean()
  clearCredentials?: boolean;
}

export class TestAiConnectionDto {
  @IsEnum(AiProvider)
  provider!: AiProvider;

  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  model!: string;

  @IsOptional()
  @Transform(({ value }) => trimmedOrUndefined(value))
  @IsString()
  @MaxLength(1024)
  apiKey?: string;
}

export class FormalizeMessageDto {
  @IsString()
  @MaxLength(AI_MAX_INPUT_CHARS)
  @Matches(/\S/, { message: 'text must not be blank' })
  text!: string;
}
