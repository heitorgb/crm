import { IsEnum, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { DeliveryConfirmationMode, StoreOrderStatus } from '@prisma/client';
import { IsBoolean } from 'class-validator';

export class CreateStoreDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  externalCode!: string;

  @IsEnum(DeliveryConfirmationMode)
  @IsOptional()
  deliveryConfirmationMode?: DeliveryConfirmationMode;
}

export class UpdateStoreDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEnum(DeliveryConfirmationMode)
  deliveryConfirmationMode?: DeliveryConfirmationMode;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ApprovedOrderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  externalOrderId!: string;

  @IsISO8601({ strict: true })
  approvedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  orderText?: string;
}

export class CreateManualOrderDto {
  @IsUUID()
  storeId!: string;

  @IsUUID()
  contactId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  orderText!: string;
}

export class UpdateOrderStatusDto {
  @IsEnum(StoreOrderStatus)
  status!: StoreOrderStatus;
}
