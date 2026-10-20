import { IsBoolean } from 'class-validator';

export class UpdatePlatformSettingsDto {
  @IsBoolean()
  linkPreviewsEnabled!: boolean;
}
