"use client";

import { useState } from "react";
import { verifyPermissionAtTime, ApiRequestError } from "@/lib/api";
import type { PermissionAction, VerifyPermissionResponse } from "@/lib/types";
import {
  Card,
  PageHeader,
  Field,
  Input,
  Select,
  Button,
  ErrorBox,
  Badge,
  Spinner,
  FadeIn,
} from "@/components/ui";

const actions: PermissionAction[] = ["READ", "WRITE", "TRANSFER"];

interface SlotState {
  label: string;
  timestamp: string; // ISO datetime-local string
  result: VerifyPermissionResponse | null;
  error: string | null;
  loading: boolean;
}

function ResultPanel({ slot }: { slot: SlotState }) {
  if (slot.loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-(--text-muted) py-2">
        <Spinner /> Querying permission version...
      </div>
    );
  }
  if (slot.error) {
    return (
      <FadeIn>
        <ErrorBox message={slot.error} />
      </FadeIn>
    );
  }
  if (!slot.result) {
    return <p className="text-sm text-(--text-faint) py-2">No query run yet.</p>;
  }
  const r = slot.result;
  return (
    <FadeIn className="space-y-3">
      <div
        className={`rounded-lg border-2 p-4 text-center ${
          r.wasLegitimate
            ? "border-(--success-border) bg-(--success-bg)"
            : "border-(--danger-border) bg-(--danger-bg)"
        }`}
      >
        <p className="text-xs uppercase tracking-wide text-(--text-muted) mb-1">
          wasLegitimate
        </p>
        <p
          className={`text-3xl font-bold ${
            r.wasLegitimate ? "text-(--success)" : "text-(--danger)"
          }`}
        >
          {String(r.wasLegitimate).toUpperCase()}
        </p>
      </div>
      <div className="text-xs text-(--text-muted) space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span>Permission version used:</span>
          <Badge>#{r.permissionVersionUsed.permissionId}</Badge>
          <Badge tone={r.permissionVersionUsed.state === "GRANTED" ? "green" : "red"}>
            {r.permissionVersionUsed.state}
          </Badge>
        </div>
        <p>
          Valid from{" "}
          {new Date(r.permissionVersionUsed.validFrom * 1000).toLocaleString()}{" "}
          until{" "}
          {r.permissionVersionUsed.validUntil === 0
            ? "still current (0)"
            : new Date(r.permissionVersionUsed.validUntil * 1000).toLocaleString()}
        </p>
        <p>Queried at timestamp: {r.atTimestamp}</p>
      </div>
    </FadeIn>
  );
}

export default function PolicyCheckPage() {
  const [assetId, setAssetId] = useState("");
  const [subjectDID, setSubjectDID] = useState("");
  const [action, setAction] = useState<PermissionAction>("READ");

  const now = new Date();
  const nowLocal = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

  const [before, setBefore] = useState<SlotState>({
    label: "Before revoke",
    timestamp: nowLocal,
    result: null,
    error: null,
    loading: false,
  });
  const [after, setAfter] = useState<SlotState>({
    label: "After revoke",
    timestamp: nowLocal,
    result: null,
    error: null,
    loading: false,
  });

  async function runQuery(
    slot: SlotState,
    setSlot: React.Dispatch<React.SetStateAction<SlotState>>
  ) {
    if (!assetId || !subjectDID) {
      setSlot((s) => ({ ...s, error: "Asset ID and subject DID are required." }));
      return;
    }
    setSlot((s) => ({ ...s, loading: true, error: null, result: null }));
    try {
      const atTimestamp = Math.floor(new Date(slot.timestamp).getTime() / 1000);
      const res = await verifyPermissionAtTime({
        assetId: Number(assetId),
        subjectDID,
        action,
        atTimestamp,
      });
      setSlot((s) => ({ ...s, loading: false, result: res }));
    } catch (err) {
      setSlot((s) => ({
        ...s,
        loading: false,
        error:
          err instanceof ApiRequestError
            ? `${err.message} (${err.code})`
            : "Query failed.",
      }));
    }
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto px-4 py-8">
      <PageHeader
        title="6. Policy-at-the-Time Query"
        description="This is the core USP: prove whether an access would have been legitimate at an exact past moment, not just under current rules. No authentication required — GET /api/permissions/verify is a public verifiability feature. Set one timestamp before your revoke and one after, then compare."
      />

      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Asset ID">
            <Input
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              placeholder="1042"
              type="number"
            />
          </Field>
          <Field label="Subject DID">
            <Input
              value={subjectDID}
              onChange={(e) => setSubjectDID(e.target.value)}
              placeholder="did:pramaan:0xDef456..."
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
        </div>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {(
          [
            [before, setBefore],
            [after, setAfter],
          ] as const
        ).map(([slot, setSlot], i) => (
          <Card key={i}>
            <h2 className="text-sm font-semibold text-(--text-primary) mb-3">
              {slot.label}
            </h2>
            <Field label="Timestamp">
              <Input
                type="datetime-local"
                value={slot.timestamp}
                onChange={(e) =>
                  setSlot((s) => ({ ...s, timestamp: e.target.value }))
                }
              />
            </Field>
            <div className="mt-3">
              <Button
                variant="secondary"
                onClick={() => runQuery(slot, setSlot)}
                disabled={slot.loading}
              >
                {slot.loading ? (
                  <>
                    <Spinner /> Querying...
                  </>
                ) : (
                  `Check "${slot.label}"`
                )}
              </Button>
            </div>
            <div className="mt-4">
              <ResultPanel slot={slot} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
