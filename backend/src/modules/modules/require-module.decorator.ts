import { SetMetadata } from '@nestjs/common';
import { REQUIRED_MODULE_KEY, type ModuleKey } from './modules.constants.js';

export const RequireModule = (moduleKey: ModuleKey) =>
  SetMetadata(REQUIRED_MODULE_KEY, moduleKey);
