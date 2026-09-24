import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../auth.constants.js';
import type { Role } from '@prisma/client';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
