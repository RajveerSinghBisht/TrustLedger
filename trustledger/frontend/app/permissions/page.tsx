"use client";

import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { setPermission, ApiRequestError } from "@/lib/api";
import type { SetPermissionResponse, PermissionAction, PermissionState } from "@/lib/types";
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
} from "@/components/ui";

const actions: PermissionAction[] = ["READ", "WRITE", "TRANSFER"];

export default function PermissionsPage() {
  const { token, claims } = useAuth();

  const [assetId, setAssetId] = useState("");
  const [subjectDID, setSubjectDID] = useState("");
  const [action, setAction] = useState<PermissionAction>("READ");

  const [submitting, setSubmitting] = useState<PermissionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<
    (SetPermissionResponse & { state: PermissionState }) | null
  >(null);

  const looksAuthorized = claims?.role === "ADMIN" || claims?.role === "MANAGER";

  async function submit(state: PermissionState) {
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
      const res = await setPermission(token, {
        assetId: Number(assetId),
        subjectDID,
        action,
        state,
      });
      setResult({ ...res, state });
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? `${err.message} (${err.code})`
          : err instanceof Error
          ? err.message
          : "Setting permission failed."
      );
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="space-y-8 max-w-3xl mx-auto px-4 py-8">
      <PageHeader
        title="3 & 5. Grant / Revoke Permission"
        description="Requires ADMIN or MANAGER. Calls AccessControl.setPermission on-chain. Permissions are versioned — nothing is overwritten, every change creates a new version with its own validFrom/validUntil, which is exactly what the policy-at-the-time screen depends on."
      />

      {!token && (
        <ErrorBox message="Not authenticated. Connect MetaMask and sign the challenge (top right) first." />
      )}
      {token && !looksAuthorized && (
        <ErrorBox
          message={`Your current session role is ${claims?.role}. Only ADMIN or MANAGER can set permissions — the backend enforces this regardless of this warning.`}
        />
      )}

      <Card>
        <div className="space-y-4">
          <Field label="Asset ID">
            <Input
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              placeholder="1"
              type="number"
            />
          </Field>

          <Field label="Subject DID" hint="The identity being granted or revoked access (e.g. did:trustledger:<wallet_address>).">
            <Input
              value={subjectDID}
              onChange={(e) => setSubjectDID(e.target.value)}
              placeholder="did:trustledger:0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
            />
          </Field>

          <Field label="Action">
            <Select value={action} onChange={(e) => setAction(e.target.value as PermissionAction)}>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex gap-3 pt-2">
            <Button
              onClick={() => submit("GRANTED")}
              disabled={submitting !== null || !token}
            >
              {submitting === "GRANTED" ? (
                <>
                  <Spinner /> Granting...
                </>
              ) : (
                "Grant access"
              )}
            </Button>
            <Button
              variant="danger"
              onClick={() => submit("REVOKED")}
              disabled={submitting !== null || !token}
            >
              {submitting === "REVOKED" ? (
                <>
                  <Spinner /> Revoking...
                </>
              ) : (
                "Revoke access"
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
          <FadeIn className="mt-4 space-y-2">
            <SuccessBox>
              Permission set to{" "}
              <Badge tone={result.state === "GRANTED" ? "green" : "red"}>
                {result.state}
              </Badge>{" "}
              — new version created (permissionId {result.permissionId}), valid
              from {new Date(result.validFrom * 1000).toLocaleString()}. Note this
              timestamp: it&apos;s what the policy-at-the-time screen uses to
              distinguish before/after this exact change.
            </SuccessBox>
            <JsonView data={result} />
          </FadeIn>
        )}
      </Card>
    </div>
  );
}
