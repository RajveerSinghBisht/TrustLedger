"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/AuthContext";
import {
  setPermission,
  requestPermission,
  getPermissionRequests,
  getAsset,
  ApiRequestError,
} from "@/lib/api";
import {
  requestPermissionOnChain,
  approvePermissionOnChain,
  cancelPermissionRequestOnChain,
} from "@/lib/contracts";
import type {
  SetPermissionResponse,
  RequestPermissionResponse,
  PermissionRequestRecord,
  PermissionRequestStatus,
  PermissionAction,
  PermissionState,
  Classification,
} from "@/lib/types";
import {
  Card,
  PageHeader,
  Field,
  Input,
  Select,
  Button,
  JsonView,
  ErrorBox,
  SuccessBox,
  Badge,
  Spinner,
  FadeIn,
  EmptyState,
} from "@/components/ui";

const actions: PermissionAction[] = ["READ", "WRITE", "TRANSFER"];

export default function PermissionsPage() {
  const { token, claims, address } = useAuth();

  // Form State
  const [assetId, setAssetId] = useState("");
  const [subjectDID, setSubjectDID] = useState("");
  const [action, setAction] = useState<PermissionAction>("READ");
  const [detectedClassification, setDetectedClassification] = useState<Classification | null>(null);
  const [checkingAsset, setCheckingAsset] = useState(false);

  // Submission State
  const [submitting, setSubmitting] = useState<PermissionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<
    | (SetPermissionResponse & { mode: "single-sig"; state: PermissionState })
    | (RequestPermissionResponse & { mode: "request"; state: PermissionState })
    | null
  >(null);

  // Dual-Custody Requests List State
  const [requests, setRequests] = useState<PermissionRequestRecord[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PermissionRequestStatus | "ALL">("ALL");
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const isOfficer = claims?.role === "ADMIN" || claims?.role === "MANAGER";

  // Check asset classification dynamically when assetId changes
  useEffect(() => {
    const idNum = Number(assetId);
    if (!assetId || isNaN(idNum) || idNum <= 0) {
      setDetectedClassification(null);
      return;
    }

    let isMounted = true;
    setCheckingAsset(true);
    getAsset(idNum)
      .then((asset) => {
        if (isMounted) {
          setDetectedClassification(asset.classification);
        }
      })
      .catch(() => {
        if (isMounted) {
          setDetectedClassification(null);
        }
      })
      .finally(() => {
        if (isMounted) setCheckingAsset(false);
      });

    return () => {
      isMounted = false;
    };
  }, [assetId]);

  // Fetch pending / all requests
  const fetchRequests = useCallback(async () => {
    if (!token) return;
    setLoadingRequests(true);
    setRequestsError(null);
    try {
      const data = await getPermissionRequests(
        token,
        statusFilter === "ALL" ? undefined : statusFilter
      );
      setRequests(data.requests);
    } catch (err) {
      setRequestsError(
        err instanceof ApiRequestError
          ? `${err.message} (${err.code})`
          : "Failed to load dual-custody requests."
      );
    } finally {
      setLoadingRequests(false);
    }
  }, [token, statusFilter]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  // Submit permission (routes to requestPermission which enforces dual-custody for CONFIDENTIAL)
  async function handleSubmit(state: PermissionState) {
    if (!token) {
      setError("Not authenticated. Connect MetaMask and sign in first.");
      return;
    }
    if (!assetId || !subjectDID) {
      setError("Asset ID and subject DID are required.");
      return;
    }
    setSubmitting(state);
    setError(null);
    setResult(null);

    try {
      if (isConfidential) {
        // Direct on-chain submission from connected wallet ensures msg.sender on-chain is the real Officer 1
        const onChainRes = await requestPermissionOnChain(
          Number(assetId),
          subjectDID,
          action,
          state
        );
        setResult({
          isDualCustody: true,
          requestId: onChainRes.requestId,
          assetId: Number(assetId),
          subjectDID,
          action,
          requestedState: state,
          requester: onChainRes.requester,
          expiresAt: onChainRes.expiresAt,
          txHash: onChainRes.txHash,
          mode: "request",
          state,
        });
      } else {
        const res = await requestPermission(token, {
          assetId: Number(assetId),
          subjectDID,
          action,
          state,
        });
        setResult({ ...res, mode: "request", state });
      }
      // Refresh requests table to show newly pending request
      fetchRequests();
    } catch (err: any) {
      setError(
        err?.message?.includes("user rejected")
          ? "Transaction rejected in wallet."
          : err instanceof ApiRequestError
          ? `${err.message} (${err.code})`
          : err instanceof Error
          ? err.message
          : "Permission request failed."
      );
    } finally {
      setSubmitting(null);
    }
  }

  // Officer 2: Co-sign and approve directly from connected MetaMask wallet
  async function handleApprove(requestId: number) {
    if (!address) {
      setActionFeedback({
        type: "error",
        message: "Please connect your wallet to co-sign.",
      });
      return;
    }
    setActionLoadingId(requestId);
    setActionFeedback(null);
    try {
      const res = await approvePermissionOnChain(requestId);
      setActionFeedback({
        type: "success",
        message: `Request #${requestId} co-signed and approved directly on-chain by Officer 2! Tx: ${res.txHash.slice(0, 10)}...`,
      });
      fetchRequests();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setActionFeedback({
        type: "error",
        message:
          msg.includes("cannot approve own request") || msg.includes("dual-custody violation")
            ? "Dual-Custody Violation: Officer 1 cannot approve their own request."
            : msg.includes("request has expired")
            ? "Permission request has expired (24-hour TTL elapsed)."
            : msg.includes("user rejected")
            ? "Transaction was rejected in MetaMask."
            : msg.includes("caller is not an active identity")
            ? "Connected account is not an active officer in IdentityRegistry."
            : "Approval transaction reverted.",
      });
    } finally {
      setActionLoadingId(null);
    }
  }

  // Requester or Admin: Cancel request directly on-chain
  async function handleCancel(requestId: number) {
    if (!address) return;
    setActionLoadingId(requestId);
    setActionFeedback(null);
    try {
      const res = await cancelPermissionRequestOnChain(requestId);
      setActionFeedback({
        type: "success",
        message: `Request #${requestId} successfully cancelled on-chain. Tx: ${res.txHash.slice(0, 10)}...`,
      });
      fetchRequests();
    } catch (err: any) {
      setActionFeedback({
        type: "error",
        message:
          err?.message?.includes("user rejected")
            ? "Cancellation rejected in wallet."
            : err?.message || "Cancellation failed.",
      });
    } finally {
      setActionLoadingId(null);
    }
  }

  function formatExpiresIn(expiresAtSeconds: number): string {
    const now = Math.floor(Date.now() / 1000);
    const diff = expiresAtSeconds - now;
    if (diff <= 0) return "Expired";
    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m remaining`;
    return `${minutes}m remaining`;
  }

  const isConfidential = detectedClassification === "CONFIDENTIAL";

  return (
    <div className="space-y-8 max-w-4xl mx-auto px-4 py-8">
      <PageHeader
        tag="SECURITY PROTOCOL // DUAL-CUSTODY"
        title="3 & 5. Access Control & Two-Man Rule"
        description="Requires ADMIN or MANAGER. Permissions are versioned and immutable — nothing is ever overwritten. For CONFIDENTIAL assets, the cryptographic Two-Man Rule is enforced on-chain: Officer 1 requests, and a distinct Officer 2 must co-sign before the 24-hour TTL expires."
      />

      {/* Protocol Architecture Banner */}
      <div className="rounded-lg border border-(--border) bg-(--surface)/40 p-4 font-mono text-xs">
        <div className="flex flex-col md:flex-row items-center justify-between gap-3 text-center md:text-left">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-(--accent) animate-pulse" />
            <span className="text-(--text-muted) uppercase tracking-wider font-semibold">
              Enforcement Protocol:
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 text-[11px]">
            <span className="px-2 py-1 rounded bg-(--surface) border border-(--border) text-(--text-primary)">
              1. Officer 1 (Maker)
            </span>
            <span className="text-(--accent) font-bold">➔</span>
            <span className="px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400">
              2. PENDING (24h TTL)
            </span>
            <span className="text-(--accent) font-bold">➔</span>
            <span className="px-2 py-1 rounded bg-(--surface) border border-(--border) text-(--text-primary)">
              3. Officer 2 (Checker Co-Sign)
            </span>
            <span className="text-(--accent) font-bold">➔</span>
            <span className="px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              4. Immutable Ledger Active
            </span>
          </div>
        </div>
      </div>

      {!token && (
        <ErrorBox message="Not authenticated. Connect MetaMask and sign the cryptographic challenge (top right) to access authorization controls." />
      )}
      {token && !isOfficer && (
        <ErrorBox
          message={`Your current identity session role is ${claims?.role}. Only ADMIN or MANAGER can request or approve permissions — the on-chain contract and backend strictly enforce this.`}
        />
      )}

      {/* Card 1: Grant / Request Permission Form */}
      <Card>
        <div className="flex items-center justify-between border-b border-(--border) pb-3 mb-4">
          <div>
            <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-(--text-primary)">
              Grant / Request Permission
            </h2>
            <p className="text-xs text-(--text-muted) mt-0.5">
              Submit an authorization grant or revocation.
            </p>
          </div>
          {detectedClassification && (
            <Badge
              tone={
                detectedClassification === "CONFIDENTIAL"
                  ? "amber"
                  : detectedClassification === "INTERNAL"
                  ? "blue"
                  : "green"
              }
            >
              ASSET #{assetId}: {detectedClassification}
            </Badge>
          )}
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="Asset ID"
              hint={
                checkingAsset
                  ? "Checking classification on-chain..."
                  : isConfidential
                  ? "CONFIDENTIAL detected: Will initiate a Dual-Custody Request requiring Officer 2."
                  : detectedClassification
                  ? `${detectedClassification} detected: Direct single-signature on-chain grant.`
                  : "Enter numeric asset ID (e.g. 1)"
              }
            >
              <Input
                value={assetId}
                onChange={(e) => setAssetId(e.target.value)}
                placeholder="1"
                type="number"
              />
            </Field>

            <Field label="Action" hint="Cryptographic action scope on this asset">
              <Select
                value={action}
                onChange={(e) => setAction(e.target.value as PermissionAction)}
              >
                {actions.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field
            label="Subject DID"
            hint="The identity being granted or revoked access (e.g. did:trustledger:<wallet_address>)."
          >
            <Input
              value={subjectDID}
              onChange={(e) => setSubjectDID(e.target.value)}
              placeholder="did:trustledger:0x0000000000000000000000000000000000000000"
            />
          </Field>

          {/* Dual-Custody Callout when asset is Confidential */}
          {isConfidential && (
            <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3.5 text-xs font-mono text-amber-300 space-y-1">
              <div className="flex items-center gap-2 font-bold uppercase tracking-wider">
                <span>[TWO-MAN RULE MANDATORY]</span>
              </div>
              <p className="text-[11px] text-amber-200/80 leading-relaxed">
                Because this asset is classified as <strong>CONFIDENTIAL</strong>, you are acting as <strong>Officer 1 (Maker)</strong>. This action will NOT grant instant access. A pending request will be created with a strict 24-hour expiration window and must be co-signed by <strong>Officer 2 (Checker)</strong>.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button
              onClick={() => handleSubmit("GRANTED")}
              disabled={submitting !== null || !token || !isOfficer}
              variant={isConfidential ? "primary" : "primary"}
              className={isConfidential ? "border border-amber-500/50" : ""}
            >
              {submitting === "GRANTED" ? (
                <>
                  <Spinner /> Submitting...
                </>
              ) : isConfidential ? (
                "Request Dual-Custody Approval (Officer 1)"
              ) : (
                "Grant Access (Single-Sig)"
              )}
            </Button>

            <Button
              variant="danger"
              onClick={() => handleSubmit("REVOKED")}
              disabled={submitting !== null || !token || !isOfficer}
            >
              {submitting === "REVOKED" ? (
                <>
                  <Spinner /> Submitting...
                </>
              ) : isConfidential ? (
                "Request Revocation (Officer 1)"
              ) : (
                "Revoke Access"
              )}
            </Button>
          </div>
        </div>

        {error && (
          <FadeIn className="mt-4">
            <ErrorBox message={error} />
          </FadeIn>
        )}

        {result && (
          <FadeIn className="mt-4 space-y-3">
            {"isDualCustody" in result && result.isDualCustody ? (
              <SuccessBox>
                <div className="space-y-1">
                  <div className="font-bold text-amber-300">
                    Dual-Custody Request #{result.requestId} Initiated!
                  </div>
                  <div className="text-xs text-(--text-muted)">
                    Status: <Badge tone="amber">PENDING</Badge> · Expires at{" "}
                    {new Date(result.expiresAt * 1000).toLocaleString()} (24-hour deterministic window).
                  </div>
                  <div className="text-[11px] text-(--text-faint) mt-1">
                    Officer 1 signature recorded. To complete activation, Officer 2 must co-sign in the Dual-Custody Ledger below.
                  </div>
                </div>
              </SuccessBox>
            ) : (
              <SuccessBox>
                Permission set to{" "}
                <Badge tone={result.state === "GRANTED" ? "green" : "red"}>
                  {result.state}
                </Badge>{" "}
                — versioned record #{"permissionId" in result ? result.permissionId : "N/A"} activated
                on-chain.
              </SuccessBox>
            )}
            <JsonView data={result} />
          </FadeIn>
        )}
      </Card>

      {/* Card 2: Dual-Custody Ledger (Pending & Historical Approvals) */}
      <Card>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-(--border) pb-4 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-(--text-primary)">
                Dual-Custody Approvals Ledger
              </h2>
              <span className="w-2 h-2 rounded-full bg-amber-400" />
            </div>
            <p className="text-xs text-(--text-muted) mt-0.5">
              Two-man rule requests awaiting or completed with Officer 2 co-signature.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            {/* Status Filter Buttons */}
            <div className="inline-flex rounded border border-(--border) p-0.5 bg-(--bg) text-[10px] font-mono">
              {(["ALL", "PENDING", "APPROVED", "CANCELLED"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-2 py-1 rounded transition-colors ${
                    statusFilter === s
                      ? "bg-(--surface) text-(--text-primary) font-semibold"
                      : "text-(--text-muted) hover:text-(--text-primary)"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            <Button
              variant="secondary"
              onClick={fetchRequests}
              disabled={loadingRequests}
              className="py-1 px-2.5 text-[11px]"
            >
              {loadingRequests ? <Spinner /> : "Refresh"}
            </Button>
          </div>
        </div>

        {actionFeedback && (
          <div className="mb-4">
            {actionFeedback.type === "success" ? (
              <SuccessBox>{actionFeedback.message}</SuccessBox>
            ) : (
              <ErrorBox message={actionFeedback.message} />
            )}
          </div>
        )}

        {requestsError && (
          <div className="mb-4">
            <ErrorBox message={requestsError} />
          </div>
        )}

        {/* Requests Table / List */}
        {requests.length === 0 ? (
          <EmptyState
            title="No Dual-Custody Requests Found"
            description={
              statusFilter === "ALL"
                ? "No dual-custody requests have been created yet. Requests created for CONFIDENTIAL assets will appear here."
                : `No requests with status '${statusFilter}'.`
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="border-b border-(--border) text-[10px] uppercase tracking-wider text-(--text-muted)">
                  <th className="py-2.5 px-3">Req ID</th>
                  <th className="py-2.5 px-3">Asset & Action</th>
                  <th className="py-2.5 px-3">Subject DID</th>
                  <th className="py-2.5 px-3">Requester (Officer 1)</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--border)">
                {requests.map((req) => {
                  const isRequester =
                    address?.toLowerCase() === req.requester.toLowerCase();
                  const isPending = req.status === "PENDING";
                  const isProcessing = actionLoadingId === req.requestId;

                  let statusTone: "amber" | "green" | "red" | "neutral" = "neutral";
                  if (req.status === "PENDING") statusTone = "amber";
                  else if (req.status === "APPROVED") statusTone = "green";
                  else if (req.status === "CANCELLED") statusTone = "red";

                  return (
                    <tr
                      key={req.requestId}
                      className="hover:bg-(--surface-hover)/40 transition-colors"
                    >
                      <td className="py-3 px-3 font-bold text-(--text-primary)">
                        #{req.requestId}
                      </td>

                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-(--accent)">
                            Asset #{req.assetId}
                          </span>
                          <span className="text-(--text-faint)">·</span>
                          <Badge
                            tone={
                              req.requestedState === "GRANTED" ? "green" : "red"
                            }
                          >
                            {req.action} ({req.requestedState})
                          </Badge>
                        </div>
                      </td>

                      <td className="py-3 px-3 text-(--text-muted) max-w-45 truncate" title={req.subjectDID}>
                        {req.subjectDID}
                      </td>

                      <td className="py-3 px-3 text-(--text-muted)">
                        <div className="flex items-center gap-1">
                          <span className="truncate max-w-30" title={req.requester}>
                            {req.requester.slice(0, 6)}...{req.requester.slice(-4)}
                          </span>
                          {isRequester && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-(--accent)/10 text-(--accent)">
                              You
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="space-y-0.5">
                          <Badge tone={statusTone}>{req.status}</Badge>
                          {isPending && (
                            <div className="text-[10px] text-amber-400/80">
                              {formatExpiresIn(req.expiresAt)}
                            </div>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-right">
                        {isPending ? (
                          <div className="flex items-center justify-end gap-2">
                            {/* Co-Sign / Approve Button */}
                            <Button
                              variant="primary"
                              disabled={!isOfficer || isRequester || isProcessing}
                              onClick={() => handleApprove(req.requestId)}
                              className="py-1 px-2.5 text-[10px]"
                              title={
                                isRequester
                                  ? "Dual-Custody Violation: Officer 1 cannot approve their own request. Switch MetaMask to Officer 2's account to co-sign."
                                  : !isOfficer
                                  ? "Role Ineligible: Only an active ADMIN or MANAGER can co-sign dual-custody requests."
                                  : "Co-sign and approve directly on-chain as Officer 2"
                              }
                            >
                              {isProcessing ? (
                                <Spinner />
                              ) : isRequester ? (
                                "Self-Approval Blocked"
                              ) : !isOfficer ? (
                                "Role Ineligible"
                              ) : (
                                "Co-Sign (Officer 2)"
                              )}
                            </Button>

                            {/* Cancel Button */}
                            {(isRequester || claims?.role === "ADMIN") && (
                              <Button
                                variant="secondary"
                                disabled={isProcessing}
                                onClick={() => handleCancel(req.requestId)}
                                className="py-1 px-2 text-[10px] text-(--danger) border-(--danger-border)/50 hover:bg-(--danger-bg)"
                                title="Cancel this pending request"
                              >
                                Cancel
                              </Button>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-(--text-faint)">
                            Completed
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
