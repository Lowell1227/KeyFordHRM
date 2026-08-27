import { SetMetadata } from '@nestjs/common';
import type { HrCapability } from '@/auth/hr-capabilities';

export const HR_CAPABILITIES_KEY = 'hrCapabilities';

export const HrCapabilities = (...capabilities: HrCapability[]) => (
  SetMetadata(HR_CAPABILITIES_KEY, capabilities)
);
