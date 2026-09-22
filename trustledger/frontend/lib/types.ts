// Types mirror DATA_MODEL.md field-for-field. Do not rename fields to be
// "more conventional" — the spec explicitly freezes these names.

export type Role = "ADMIN" | "MANAGER" | "AUDITOR" | "USER";
export type IdentityStatus = "ACTIVE" | "REVOKED";
export type Classification = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL";
export type AssetStatus = "ACTIVE" | "REVOKED";
export type PermissionAction = "READ" | "WRITE" | "TRANSFER";
export type PermissionState = "GRANTED" | "REVOKED";

export interface ApiError {
  error: string;
  code: string;
}

export interface ChallengeResponse {
  message: string;
  expiresAt: string;
}

export interface VerifyResponse {
  token: string;
  expiresAt: string;
}

export interface JwtClaims {
  did: string;
  address: string;
  role: Role;
  iat: number;
  exp: number;
}

export interface IdentityRecord {
  did: string;
  role: Role;
  status: IdentityStatus;
  displayName?: string;
  txHash?: string;
}

export interface AssetRecord {
  assetId: number;
  assetHash: string;
  ownerDID: string;
  metadataURI: string;
  classification: Classification;
  status: AssetStatus;
  version?: number;
  createdAt?: number;
  original_filename?: string;
  mime_type?: string;
}

export interface RegisterAssetResponse {
  assetId: number;
  assetHash: string;
  metadataURI: string;
  txHash: string;
}

export interface SetPermissionResponse {
  permissionId: number;
  validFrom: number;
  txHash: string;
}

export interface PermissionVersion {
  permissionId: number;
  state: PermissionState;
  validFrom: number;
  validUntil: number; // 0 means still current
}

export interface VerifyPermissionResponse {
  assetId: number;
  subjectDID: string;
  action: PermissionAction;
  atTimestamp: number;
  wasLegitimate: boolean;
  permissionVersionUsed: PermissionVersion;
}

export interface ProofBundle {
  assetId: number;
  assetHash: string;
  accessedBy: string;
  accessTimestamp: number;
  permissionVersionUsed: PermissionVersion;
  onChainTxRef: string;
  signature: string;
}

export interface ProofBundleVerifyResponse {
  valid: boolean;
  reason: string | null;
}
