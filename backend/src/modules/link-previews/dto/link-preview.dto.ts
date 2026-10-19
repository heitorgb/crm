import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';
import {
  MAX_PREVIEW_URLS_PER_MESSAGE,
  MAX_PREVIEW_URL_LENGTH,
} from '../../../common/link-preview/link-preview.js';

export class ResolveLinkPreviewsDto {
  @IsArray()
  @ArrayMaxSize(MAX_PREVIEW_URLS_PER_MESSAGE)
  @IsString({ each: true })
  @MaxLength(MAX_PREVIEW_URL_LENGTH, { each: true })
  urls!: string[];
}
