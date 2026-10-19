import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../../common/http/pagination.js';

export const WEBHOOK_GROUP_JID_PATTERN = /^[0-9][0-9-]*@g\.us$/;
export const WEBHOOK_MAX_MESSAGE_LENGTH = 4096;
export const WEBHOOK_MAX_CAPTION_LENGTH = 1024;
export const WEBHOOK_MAX_IMAGE_URL_LENGTH = 2048;

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

  @IsOptional()
  @IsUrl(
    { protocols: ['https'], require_protocol: true },
    { message: 'imageUrl deve ser uma URL HTTPS válida' },
  )
  @MaxLength(WEBHOOK_MAX_IMAGE_URL_LENGTH)
  imageUrl?: string;
}
