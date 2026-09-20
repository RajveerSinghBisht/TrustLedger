/// <reference types="jest" />

import {
  AuthorizationError,
  createAuthorizationService,
} from "../authorizationService";

describe("authorizationService", () => {
  test("allows an active ADMIN for an ADMIN-only operation", async () => {
    const isActive = jest.fn().mockResolvedValue(true);
    const getRole = jest.fn().mockResolvedValue(1);

    const service = createAuthorizationService({
      isActive,
      getRole,
    });

    await expect(
      service.requireCurrentRole("0xAdmin", ["ADMIN"])
    ).resolves.toBe("ADMIN");

    expect(isActive).toHaveBeenCalledWith("0xAdmin");
    expect(getRole).toHaveBeenCalledWith("0xAdmin");
  });

  test("allows an active MANAGER for an ADMIN-or-MANAGER operation", async () => {
    const isActive = jest.fn().mockResolvedValue(true);
    const getRole = jest.fn().mockResolvedValue(2);

    const service = createAuthorizationService({
      isActive,
      getRole,
    });

    await expect(
      service.requireCurrentRole("0xManager", ["ADMIN", "MANAGER"])
    ).resolves.toBe("MANAGER");
  });

  test("rejects a revoked identity before accepting its role", async () => {
    const isActive = jest.fn().mockResolvedValue(false);
    const getRole = jest.fn().mockResolvedValue(2);

    const service = createAuthorizationService({
      isActive,
      getRole,
    });

    await expect(
      service.requireCurrentRole(
        "0xRevokedManager",
        ["ADMIN", "MANAGER"]
      )
    ).rejects.toMatchObject({
      code: "IDENTITY_REVOKED",
    });

    expect(isActive).toHaveBeenCalledWith("0xRevokedManager");

    expect(getRole).not.toHaveBeenCalled();
  });

  test("rejects an active USER attempting a MANAGER operation", async () => {
    const isActive = jest.fn().mockResolvedValue(true);
    const getRole = jest.fn().mockResolvedValue(4);

    const service = createAuthorizationService({
      isActive,
      getRole,
    });

    await expect(
      service.requireCurrentRole("0xUser", ["ADMIN", "MANAGER"])
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_ROLE",
    });

    expect(getRole).toHaveBeenCalledWith("0xUser");
  });

  test("rejects an unregistered identity whose role is NONE", async () => {
    const isActive = jest.fn().mockResolvedValue(true);
    const getRole = jest.fn().mockResolvedValue(0);

    const service = createAuthorizationService({
      isActive,
      getRole,
    });

    await expect(
      service.requireCurrentRole("0xUnknown", ["ADMIN", "MANAGER"])
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_ROLE",
    });
  });

  test("uses the current on-chain role rather than a JWT role", async () => {
    /*
     * Simulates the security-critical case:
     *
     * JWT role: MANAGER
     * Current IdentityRegistry role: USER
     *
     * This service deliberately does not accept a JWT role.
     * It reads the current role directly from IdentityRegistry.
     */
    const isActive = jest.fn().mockResolvedValue(true);
    const getRole = jest.fn().mockResolvedValue(4);

    const service = createAuthorizationService({
      isActive,
      getRole,
    });

    await expect(
      service.requireCurrentRole(
        "0xFormerManager",
        ["ADMIN", "MANAGER"]
      )
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_ROLE",
    });

    expect(isActive).toHaveBeenCalledWith("0xFormerManager");
    expect(getRole).toHaveBeenCalledWith("0xFormerManager");
  });

  test("maps ADMIN correctly", async () => {
    const isActive = jest.fn().mockResolvedValue(true);
    const getRole = jest.fn().mockResolvedValue(1);

    const service = createAuthorizationService({
      isActive,
      getRole,
    });

    await expect(
      service.requireCurrentRole("0xIdentity", ["ADMIN"])
    ).resolves.toBe("ADMIN");
  });

  test("maps MANAGER correctly", async () => {
    const isActive = jest.fn().mockResolvedValue(true);
    const getRole = jest.fn().mockResolvedValue(2);

    const service = createAuthorizationService({
      isActive,
      getRole,
    });

    await expect(
      service.requireCurrentRole("0xIdentity", ["MANAGER"])
    ).resolves.toBe("MANAGER");
  });

  test("maps AUDITOR correctly", async () => {
    const isActive = jest.fn().mockResolvedValue(true);
    const getRole = jest.fn().mockResolvedValue(3);

    const service = createAuthorizationService({
      isActive,
      getRole,
    });

    await expect(
      service.requireCurrentRole("0xIdentity", ["AUDITOR"])
    ).resolves.toBe("AUDITOR");
  });

  test("maps USER correctly", async () => {
    const isActive = jest.fn().mockResolvedValue(true);
    const getRole = jest.fn().mockResolvedValue(4);

    const service = createAuthorizationService({
      isActive,
      getRole,
    });

    await expect(
      service.requireCurrentRole("0xIdentity", ["USER"])
    ).resolves.toBe("USER");
  });

  test("rejects an unsupported contract role", async () => {
    const isActive = jest.fn().mockResolvedValue(true);
    const getRole = jest.fn().mockResolvedValue(99);

    const service = createAuthorizationService({
      isActive,
      getRole,
    });

    await expect(
      service.requireCurrentRole("0xIdentity", ["ADMIN"])
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_ROLE",
    });
  });

  test("returns AuthorizationError for a revoked identity", async () => {
    const isActive = jest.fn().mockResolvedValue(false);
    const getRole = jest.fn();

    const service = createAuthorizationService({
      isActive,
      getRole,
    });

    let thrownError: unknown;

    try {
      await service.requireCurrentRole("0xRevoked", ["ADMIN"]);
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(AuthorizationError);

    expect(thrownError).toMatchObject({
      name: "AuthorizationError",
      code: "IDENTITY_REVOKED",
    });
  });
});