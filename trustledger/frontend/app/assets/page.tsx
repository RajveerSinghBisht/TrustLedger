"use client";

import { useState, useRef } from "react";
import { useAuth } from "@/lib/AuthContext";
import { registerAsset, getAsset, ApiRequestError } from "@/lib/api";
import type { RegisterAssetResponse, AssetRecord, Classification } from "@/lib/types";
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
  Spinner,
  EmptyState,
  FadeIn,
  Modal,
  Badge,
} from "@/components/ui";

const classifications: Classification[] = ["PUBLIC", "INTERNAL", "CONFIDENTIAL"];

export default function AssetsPage() {
  const { token, did, claims } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [ownerDID, setOwnerDID] = useState("");
  const [classification, setClassification] = useState<Classification>("INTERNAL");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterAssetResponse | null>(null);

  // Blockchain immutability recheck modal state
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [stagedFile, setStagedFile] = useState<File | null>(null);

  const [lookupId, setLookupId] = useState("");
  const [lookupResult, setLookupResult] = useState<AssetRecord | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  function handlePreSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      setError("Not authenticated. Connect MetaMask and sign in first.");
      return;
    }
    if (claims?.role !== "ADMIN") {
      setError("Only ADMIN role can register assets in AssetRegistry.sol.");
      return;
    }
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file to upload.");
      return;
    }
    setError(null);
    setStagedFile(file);
    setShowConfirmModal(true);
  }

  async function handleConfirmedSubmit() {
    setShowConfirmModal(false);
    if (!token) return;
    const file = stagedFile || fileRef.current?.files?.[0];
    if (!file) return;

    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await registerAsset(token, file, ownerDID || did || "", classification);
      setResult(res);
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? `${err.message} (${err.code})`
          : err instanceof Error
          ? err.message
          : "Asset registration failed."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    setLookupLoading(true);
    setLookupError(null);
    setLookupResult(null);
    try {
      const res = await getAsset(Number(lookupId));
      setLookupResult(res);
    } catch (err) {
      setLookupError(
        err instanceof ApiRequestError ? `${err.message} (${err.code})` : "Lookup failed."
      );
    } finally {
      setLookupLoading(false);
    }
  }

  return (
    <div className="space-y-8 max-w-3xl mx-auto px-4 py-8">
      <PageHeader
        title="2. Register an Asset"
        description="Requires ADMIN. Uploads a file (multipart/form-data), which the backend hashes, encrypts, stores off-chain, and registers on-chain via AssetRegistry.registerAsset."
      />

      {!token && (
        <ErrorBox message="Not authenticated. Connect MetaMask and sign the challenge (top right) before uploading." />
      )}
      {token && claims?.role !== "ADMIN" && (
        <ErrorBox
          message={`Your current session role is ${claims?.role}. Only ADMIN can register assets on-chain in AssetRegistry.sol. To upload documents, connect as ADMIN (Account #0). You can specify a Manager's DID as the Owner DID so they own the asset.`}
        />
      )}

      <Card>
        <form onSubmit={handlePreSubmit} className="space-y-4">
          <Field label="File">
            <div className="text-sm text-(--text-muted)">
              <input
                ref={fileRef}
                type="file"
                required
                className="block w-full cursor-pointer file:mr-4 file:rounded file:border-0 file:bg-(--surface-hover) file:px-3 file:py-2 file:font-medium file:text-(--text-primary) hover:file:bg-(--border-hover) transition-colors"
              />
            </div>
          </Field>

          <Field
            label="Owner DID"
            hint="Defaults to your own DID if left blank; can register on behalf of any DID as Admin."
          >
            <Input
              value={ownerDID}
              onChange={(e) => setOwnerDID(e.target.value)}
              placeholder={did ?? "did:trustledger:0x..."}
            />
          </Field>

          <Field label="Classification">
            <Select
              value={classification}
              onChange={(e) => setClassification(e.target.value as Classification)}
            >
              {classifications.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>

          <Button type="submit" disabled={submitting || !token || claims?.role !== "ADMIN"}>
            {submitting ? (
              <>
                <Spinner /> Uploading...
              </>
            ) : (
              "Register asset"
            )}
          </Button>
        </form>

        {error && (
          <FadeIn className="mt-4">
            <ErrorBox message={error} />
          </FadeIn>
        )}
        {result && (
          <FadeIn className="mt-4 space-y-2">
            <SuccessBox>
              Asset registered — note the <strong>assetId ({result.assetId})</strong>, you&apos;ll need it for permissions, download, and policy checks.
            </SuccessBox>
            <JsonView data={result} />
          </FadeIn>
        )}
      </Card>

      {/* Blockchain Immutability Recheck Modal */}
      <Modal open={showConfirmModal} onClose={() => !submitting && setShowConfirmModal(false)}>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0 text-amber-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <div>
              <span className="font-mono text-[10px] tracking-wider uppercase text-amber-500 font-semibold block mb-1">
                BLOCKCHAIN IMMUTABILITY CHECK
              </span>
              <h3 className="text-lg font-bold text-(--text-primary) tracking-tight">
                Recheck Asset Details Before Registering
              </h3>
            </div>
          </div>

          {/* Warning Banner */}
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-xs font-mono text-(--text-muted) space-y-2 leading-relaxed">
            <p className="text-(--text-primary) font-semibold flex items-center gap-1.5">
              <span>⚠️</span> Once saved on-chain, nothing can be edited or tampered with.
            </p>
            <p>
              As this is committed to the blockchain, the cryptographic SHA-256 fingerprint, ownership DID, and classification level are permanently immutable. Please verify that all document attributes are correct.
            </p>
          </div>

          {/* Staged Details Review */}
          <div className="rounded-xl border border-(--border) bg-(--bg) p-4 text-xs font-mono">
            <div className="divide-y divide-(--border)">
              <div className="py-2.5 flex justify-between items-center gap-4">
                <span className="text-(--text-muted)">DOCUMENT_FILE:</span>
                <span className="text-(--text-primary) font-medium truncate max-w-xs text-right">
                  {stagedFile?.name ?? "document"}
                </span>
              </div>
              <div className="py-2.5 flex justify-between items-center gap-4">
                <span className="text-(--text-muted)">DOCUMENT_SIZE:</span>
                <span className="text-(--text-primary)">
                  {stagedFile
                    ? stagedFile.size > 1024 * 1024
                      ? `${(stagedFile.size / (1024 * 1024)).toFixed(2)} MB`
                      : `${(stagedFile.size / 1024).toFixed(1)} KB`
                    : "0 KB"}
                </span>
              </div>
              <div className="py-2.5 flex justify-between items-center gap-4">
                <span className="text-(--text-muted)">CLASSIFICATION:</span>
                <Badge tone={classification === "CONFIDENTIAL" ? "amber" : classification === "INTERNAL" ? "blue" : "green"}>
                  {classification}
                </Badge>
              </div>
              <div className="py-2.5 flex justify-between items-center gap-4">
                <span className="text-(--text-muted)">ASSIGNED_OWNER:</span>
                <span className="text-(--text-primary) truncate max-w-xs text-right">
                  {ownerDID.trim() || did || "Self"}
                </span>
              </div>
              <div className="py-2.5 flex justify-between items-center gap-4">
                <span className="text-(--text-muted)">TARGET_CONTRACT:</span>
                <span className="text-(--accent) font-semibold">AssetRegistry.sol</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowConfirmModal(false)}
              className="w-full sm:w-auto"
            >
              Cancel &amp; Recheck
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleConfirmedSubmit}
              disabled={submitting}
              className="w-full sm:w-auto font-bold"
            >
              {submitting ? (
                <>
                  <Spinner /> Committing...
                </>
              ) : (
                "Confirm & Commit to Blockchain"
              )}
            </Button>
          </div>
        </div>
      </Modal>

      <Card>
        <h2 className="text-sm font-semibold text-(--text-primary) mb-3">
          Look up an asset
        </h2>
        <p className="text-xs text-(--text-muted) mb-3">
          Public endpoint — metadata only, not the encrypted file itself.
        </p>
        <form onSubmit={handleLookup} className="flex gap-2">
          <Input
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            placeholder="assetId, e.g. 1042"
            type="number"
          />
          <Button type="submit" variant="secondary" disabled={lookupLoading}>
            {lookupLoading ? (
              <>
                <Spinner /> Looking up...
              </>
            ) : (
              "Look up"
            )}
          </Button>
        </form>

        {lookupError && (
          <FadeIn className="mt-3">
            <ErrorBox message={lookupError} />
          </FadeIn>
        )}
        {lookupResult && (
          <FadeIn className="mt-3">
            <JsonView data={lookupResult} />
          </FadeIn>
        )}
        {!lookupResult && !lookupError && !lookupLoading && (
          <div className="mt-4">
            <EmptyState
              icon={
                <svg
                  className="w-7 h-7 mx-auto"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                  />
                </svg>
              }
              title="No asset looked up yet"
              description="Enter an asset ID above to query on-chain and off-chain metadata."
            />
          </div>
        )}
      </Card>
    </div>
  );
}
