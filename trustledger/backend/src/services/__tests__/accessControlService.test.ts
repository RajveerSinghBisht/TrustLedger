/// <reference types="jest" />

import {
  checkPermissionNow,
  checkPermissionAtTime,
  setPermission,
  recordAccess,
  requestPermission,
  requestPermissionAndDecode,
  approvePermission,
  approvePermissionAndDecode,
  cancelPermissionRequest,
  cancelPermissionRequestAndDecode,
  getPermissionRequest,
  getPermissionRequests,
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

  test("exports requestPermission", () => {
    expect(typeof requestPermission).toBe("function");
  });

  test("exports requestPermissionAndDecode", () => {
    expect(typeof requestPermissionAndDecode).toBe("function");
  });

  test("exports approvePermission", () => {
    expect(typeof approvePermission).toBe("function");
  });

  test("exports approvePermissionAndDecode", () => {
    expect(typeof approvePermissionAndDecode).toBe("function");
  });

  test("exports cancelPermissionRequest", () => {
    expect(typeof cancelPermissionRequest).toBe("function");
  });

  test("exports cancelPermissionRequestAndDecode", () => {
    expect(typeof cancelPermissionRequestAndDecode).toBe("function");
  });

  test("exports getPermissionRequest", () => {
    expect(typeof getPermissionRequest).toBe("function");
  });

  test("exports getPermissionRequests", () => {
    expect(typeof getPermissionRequests).toBe("function");
  });
});