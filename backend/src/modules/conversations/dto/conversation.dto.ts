import { ConversationStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/pagination.js';

export const CONVERSATION_SORT_FIELDS = ['lastMessageAt', 'createdAt', 'updatedAt'] as const;

export type ConversationSortField = (typeof CONVERSATION_SORT_FIELDS)[number];

export class ListConversationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ConversationStatus)
  status?: ConversationStatus;

  @IsOptional()
  @IsUUID()
  whatsappInstanceId?: string;

  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;
}

export class CreateConversationDto {
  @IsUUID()
  whatsappInstanceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalContactId?: string;

  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;
}

export class UpdateConversationDto {
  @IsOptional()
  @IsEnum(ConversationStatus)
  status?: ConversationStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string | null;

  @IsOptional()
  @IsUUID()
  leadId?: string | null;

  @IsOptional()
  @IsUUID()
  customerId?: string | null;

  @IsOptional()
  @IsUUID()
  contactId?: string | null;
}

export class SendConversationMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;
}
