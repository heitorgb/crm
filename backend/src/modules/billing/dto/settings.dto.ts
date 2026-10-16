import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  BILLING_MAX_REMINDER_OFFSETS,
  BILLING_MAX_REMINDER_OFFSET_DAYS,
} from '../billing.constants.js';

export class UpdateBillingSettingsDto {
  @IsOptional()
  @IsBoolean()
  remindersEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BILLING_MAX_REMINDER_OFFSETS)
  @IsInt({ each: true })
  @Min(-BILLING_MAX_REMINDER_OFFSET_DAYS, { each: true })
  @Max(BILLING_MAX_REMINDER_OFFSET_DAYS, { each: true })
  reminderOffsets?: number[];

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  messageTemplate?: string;

  @IsOptional()
  @IsUUID()
  whatsappInstanceId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  sendWindowStartHour?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  sendWindowEndHour?: number;
}
