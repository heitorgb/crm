import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AiProvider } from '@prisma/client';

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

export class UpdateTranscriptionSettingsDto {
  @IsBoolean()
  enabled!: boolean;

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
