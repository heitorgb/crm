import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const PUSH_DEVICE_PLATFORMS = ['android'] as const;

export type PushDevicePlatform = (typeof PUSH_DEVICE_PLATFORMS)[number];

export class UnregisterPushDeviceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  @Matches(/^\S+$/, { message: 'token must not contain whitespace' })
  token!: string;
}

export class RegisterPushDeviceDto extends UnregisterPushDeviceDto {
  @IsIn(PUSH_DEVICE_PLATFORMS)
  platform!: PushDevicePlatform;
}
