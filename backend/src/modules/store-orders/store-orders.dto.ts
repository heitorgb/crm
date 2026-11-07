import { ArrayMaxSize, ArrayUnique, IsArray, IsEnum, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { DeliveryConfirmationMode, StoreOrderStatus } from '@prisma/client';
import { IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

const DECIMAL_PATTERN = /^\d{1,10}(?:\.\d{1,4})?$/;

export class ApprovedOrderItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  productCode!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

  @IsString()
  @Matches(DECIMAL_PATTERN)
  quantity!: string;

  @IsString()
  @Matches(DECIMAL_PATTERN)
  unitPrice!: string;

  @IsString()
  @Matches(DECIMAL_PATTERN)
  lineTotal!: string;
}

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

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ApprovedOrderItemDto)
  items?: ApprovedOrderItemDto[];

  @IsOptional()
  @IsString()
  @Matches(DECIMAL_PATTERN)
  totalAmount?: string;
}

export class CreateManualOrderDto {
  @IsOptional()
  @IsUUID()
  requestId?: string;

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

export class UpdateDeliveryCardsDto {
  @IsArray()
  @ArrayMaxSize(6)
  @ArrayUnique()
  @IsEnum(StoreOrderStatus, { each: true })
  statuses!: StoreOrderStatus[];
}
