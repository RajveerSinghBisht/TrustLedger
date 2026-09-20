/// <reference types="jest" />

import {
  checkPermissionNow,
  checkPermissionAtTime,
  setPermission,
  recordAccess,
  _resetAccessControlServiceForTests,
} from "../accessControlService";

describe("accessControlService", () => {
  afterEach(() => {
    _resetAccessControlServiceForTests();
  });

  test("exports checkPermissionNow", () => {
    expect(typeof checkPermissionNow).toBe("function");
  });

  test("exports checkPermissionAtTime", () => {
    expect(typeof checkPermissionAtTime).toBe("function");
  });

  test("exports setPermission", () => {
    expect(typeof setPermission).toBe("function");
  });

  test("exports recordAccess", () => {
    expect(typeof recordAccess).toBe("function");
  });
});