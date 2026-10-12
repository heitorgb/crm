import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateTenantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;
}
