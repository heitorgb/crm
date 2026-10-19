import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../../common/http/pagination.js';

export const WEBHOOK_GROUP_JID_PATTERN = /^[0-9][0-9-]*@g\.us$/;
export const WEBHOOK_MAX_MESSAGE_LENGTH = 4096;

export class CreateWebhookIntegrationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsUUID()
  whatsappInstanceId!: string;

  @IsString()
  @MaxLength(200)
  @Matches(WEBHOOK_GROUP_JID_PATTERN, {
    message: 'groupJid deve identificar um grupo do WhatsApp (@g.us)',
  })
  groupJid!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  groupName?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateWebhookIntegrationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsUUID()
  whatsappInstanceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(WEBHOOK_GROUP_JID_PATTERN, {
    message: 'groupJid deve identificar um grupo do WhatsApp (@g.us)',
  })
  groupJid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  groupName?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ListWebhookIntegrationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  active?: boolean;
}

export class ListWebhookExecutionsQueryDto extends PaginationQueryDto {}

export class ExecuteWebhookDto {
  @IsString()
  @MinLength(1)
  @MaxLength(WEBHOOK_MAX_MESSAGE_LENGTH)
  message!: string;
}
