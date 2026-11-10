import { Body, Controller, Delete, HttpCode, Post } from '@nestjs/common';
import { RegisterPushDeviceDto, UnregisterPushDeviceDto } from './dto/push-device.dto.js';
import { PushDevicesService } from './push-devices.service.js';

@Controller('push-devices')
export class PushDevicesController {
  constructor(private readonly devices: PushDevicesService) {}

  @Post()
  @HttpCode(204)
  async register(@Body() dto: RegisterPushDeviceDto): Promise<void> {
    await this.devices.register(dto);
  }

  @Delete()
  @HttpCode(204)
  async unregister(@Body() dto: UnregisterPushDeviceDto): Promise<void> {
    await this.devices.unregister(dto.token);
  }
}
