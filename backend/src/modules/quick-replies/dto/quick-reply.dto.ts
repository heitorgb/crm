import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/pagination.js';

export const QUICK_REPLY_SORT_FIELDS = ['createdAt', 'updatedAt', 'title'] as const;

export type QuickReplySortField = (typeof QUICK_REPLY_SORT_FIELDS)[number];

export class CreateQuickReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/\S/, { message: 'title must not be blank' })
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  @Matches(/\S/, { message: 'content must not be blank' })
  content!: string;
}

export class UpdateQuickReplyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/\S/, { message: 'title must not be blank' })
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  @Matches(/\S/, { message: 'content must not be blank' })
  content?: string;
}

export class ListQuickRepliesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(QUICK_REPLY_SORT_FIELDS)
  sort: QuickReplySortField = 'title';
}
