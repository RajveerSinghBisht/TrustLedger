import type { JwtRole } from "./authService";
import {
  getRole,
  isActive,
} from "./identityRegistryService";

export interface AuthorizationDependencies {
  getRole: typeof getRole;
  isActive: typeof isActive;
}

export class AuthorizationError extends Error {
  readonly code: "IDENTITY_REVOKED" | "INSUFFICIENT_ROLE";

  constructor(
    message: string,
    code: "IDENTITY_REVOKED" | "INSUFFICIENT_ROLE"
  ) {
    super(message);
    this.name = "AuthorizationError";
    this.code = code;
  }
}

/**
 * IdentityRegistry.sol's authoritative Role enum:
 *
 * NONE    = 0
 * ADMIN   = 1
 * MANAGER = 2
 * AUDITOR = 3
 * USER    = 4
 */
function roleFromContractValue(value: number): JwtRole | null {
  const roles: Record<number, JwtRole> = {
    1: "ADMIN",
    2: "MANAGER",
    3: "AUDITOR",
    4: "USER",
  };

  return roles[value] ?? null;
}

/**
 * Performs the CURRENT on-chain authorization check required for
 * privileged backend writes.
 *
 * IMPORTANT:
 * - The address must come from the verified JWT.
 * - The JWT's cached `role` claim is deliberately NOT accepted here.
 * - Both active status and role are read freshly from IdentityRegistry.
 *
 * This implements the backend side of the relayer trust boundary described
 * in BACKEND_SPEC.md.
 */
export function createAuthorizationService(
  deps: AuthorizationDependencies = {
    getRole,
    isActive,
  }
) {
  return {
    async requireCurrentRole(
      address: string,
      allowedRoles: readonly JwtRole[]
    ): Promise<JwtRole> {
      const active = await deps.isActive(address);

      if (!active) {
        throw new AuthorizationError(
          "Identity is not currently active",
          "IDENTITY_REVOKED"
        );
      }

      const numericRole = await deps.getRole(address);
      const currentRole = roleFromContractValue(numericRole);

      if (
        currentRole === null ||
        !allowedRoles.includes(currentRole)
      ) {
        throw new AuthorizationError(
          "Identity does not have the required role",
          "INSUFFICIENT_ROLE"
        );
      }

      return currentRole;
    },
  };
}

export const authorizationService =
  createAuthorizationService();