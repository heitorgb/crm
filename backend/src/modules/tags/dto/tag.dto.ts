import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/pagination.js';

export const TAG_SORT_FIELDS = ['createdAt', 'updatedAt', 'name'] as const;

export type TagSortField = (typeof TAG_SORT_FIELDS)[number];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export class CreateTagDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @Matches(HEX_COLOR, { message: 'color must be a hex color like #22C55E' })
  color?: string;
}

export class UpdateTagDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @Matches(HEX_COLOR, { message: 'color must be a hex color like #22C55E' })
  color?: string | null;
}

export class ListTagsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(TAG_SORT_FIELDS)
  sort: TagSortField = 'name';
}
