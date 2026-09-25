import type {
  ApiError,
  ChallengeResponse,
  VerifyResponse,
  IdentityRecord,
  AssetRecord,
  RegisterAssetResponse,
  SetPermissionResponse,
  VerifyPermissionResponse,
  ProofBundle,
  ProofBundleVerifyResponse,
  PermissionAction,
  PermissionState,
  Classification,
  Role,
} from "./types";

// Base URL for PRAMAAN backend API. Overridable via env
// for when the backend runs elsewhere (e.g. deployed, different port).
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

export class ApiRequestError extends Error {
  code: string;
  status: number;
  constructor(status: number, body: ApiError) {
    super(body.error);
    this.code = body.code;
    this.status = status;
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let body: ApiError;
    try {
      body = await res.json();
    } catch {
      // Backend contract guarantees { error, code } on every error response
      // (see PRAMAAN backend specification). A non-JSON error body means
      // something is wrong outside the documented contract (e.g. a proxy
      // or CORS failure returning HTML) — surface that plainly rather than
      // inventing a code.
      throw new ApiRequestError(res.status, {
        error: `Non-JSON error response (status ${res.status}). This is outside the documented API contract — check CORS setup and that the backend is actually running at ${API_BASE_URL}.`,
        code: "UNEXPECTED_RESPONSE_SHAPE",
      });
    }
    throw new ApiRequestError(res.status, body);
  }
  return res.json();
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

// ---- Auth ----

export async function postChallenge(did: string): Promise<ChallengeResponse> {
  const res = await fetch(`${API_BASE_URL}/api/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ did }),
  });
  return handle<ChallengeResponse>(res);
}

export async function postVerify(
  did: string,
  message: string,
  signature: string
): Promise<VerifyResponse> {
  const res = await fetch(`${API_BASE_URL}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ did, message, signature }),
  });
  return handle<VerifyResponse>(res);
}

// ---- Identities ----

export async function registerIdentity(
  token: string,
  params: {
    identityAddress: string;
    did: string;
    publicKey: string;
    role: Role;
    displayName: string;
  }
): Promise<IdentityRecord & { txHash: string }> {
  const res = await fetch(`${API_BASE_URL}/api/identities`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(params),
  });
  return handle(res);
}

export async function getIdentity(did: string): Promise<IdentityRecord> {
  const res = await fetch(
    `${API_BASE_URL}/api/identities/${encodeURIComponent(did)}`
  );
  return handle<IdentityRecord>(res);
}

export async function updateIdentityDisplayName(
  token: string,
  did: string,
  displayName: string
): Promise<IdentityRecord> {
  const res = await fetch(
    `${API_BASE_URL}/api/identities/${encodeURIComponent(did)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify({ displayName }),
    }
  );
  return handle<IdentityRecord>(res);
}

// ---- Assets ----

export async function registerAsset(
  token: string,
  file: File,
  ownerDID: string,
  classification: Classification
): Promise<RegisterAssetResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("ownerDID", ownerDID);
  formData.append("classification", classification);

  const res = await fetch(`${API_BASE_URL}/api/assets`, {
    method: "POST",
    headers: authHeaders(token), // do NOT set Content-Type — browser sets multipart boundary
    body: formData,
  });
  return handle<RegisterAssetResponse>(res);
}

export async function getAsset(assetId: number): Promise<AssetRecord> {
  const res = await fetch(`${API_BASE_URL}/api/assets/${assetId}`);
  return handle<AssetRecord>(res);
}

export interface DownloadResult {
  blob: Blob;
  filename: string | null;
  proofBundle: ProofBundle;
}

export async function downloadAsset(
  token: string,
  assetId: number
): Promise<DownloadResult> {
  const res = await fetch(`${API_BASE_URL}/api/assets/${assetId}/download`, {
    headers: authHeaders(token),
  });

  if (!res.ok) {
    // Reuse the same error handling path for consistency, even though the
    // success path here isn't JSON.
    return handle(res);
  }

  const proofHeader = res.headers.get("X-Proof-Bundle");
  if (!proofHeader) {
    throw new Error(
      "Download succeeded but no X-Proof-Bundle header was present. Per the spec this header is mandatory on every successful download — this indicates a backend deviation, not a frontend bug."
    );
  }

  let proofBundle: ProofBundle;
  try {
    proofBundle = JSON.parse(atob(proofHeader));
  } catch {
    throw new Error(
      "X-Proof-Bundle header was present but could not be base64/JSON decoded."
    );
  }

  const disposition = res.headers.get("Content-Disposition");
  const filenameMatch = disposition?.match(/filename="?([^"]+)"?/);

  const blob = await res.blob();
  return { blob, filename: filenameMatch?.[1] ?? null, proofBundle };
}

// ---- Permissions ----

export async function setPermission(
  token: string,
  params: {
    assetId: number;
    subjectDID: string;
    action: PermissionAction;
    state: PermissionState;
  }
): Promise<SetPermissionResponse> {
  const res = await fetch(`${API_BASE_URL}/api/permissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(params),
  });
  return handle<SetPermissionResponse>(res);
}

export async function verifyPermissionAtTime(params: {
  assetId: number;
  subjectDID: string;
  action: PermissionAction;
  atTimestamp: number;
}): Promise<VerifyPermissionResponse> {
  const qs = new URLSearchParams({
    assetId: String(params.assetId),
    subjectDID: params.subjectDID,
    action: params.action,
    atTimestamp: String(params.atTimestamp),
  });
  const res = await fetch(`${API_BASE_URL}/api/permissions/verify?${qs}`);
  return handle<VerifyPermissionResponse>(res);
}

// ---- Proof bundles ----

export async function verifyProofBundle(
  bundle: ProofBundle
): Promise<ProofBundleVerifyResponse> {
  const res = await fetch(`${API_BASE_URL}/api/proof-bundles/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bundle),
  });
  return handle<ProofBundleVerifyResponse>(res);
}
