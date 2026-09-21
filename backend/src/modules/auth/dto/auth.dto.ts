import { IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsUUID()
  tenantId?: string;
}

export class RefreshDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  refreshToken?: string;
}

export class SwitchTenantDto {
  @IsUUID()
  tenantId!: string;
}
