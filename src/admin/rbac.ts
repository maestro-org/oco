import { ValidationError } from '../errors';
import { AdminRole } from './types';

const ROLE_LEVEL: Record<AdminRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

export function hasRole(role: AdminRole, minimum: AdminRole): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[minimum];
}

export function requireRole(role: AdminRole, minimum: AdminRole): void {
  if (!hasRole(role, minimum)) {
    throw new ValidationError(`insufficient role: requires ${minimum}`);
  }
}
