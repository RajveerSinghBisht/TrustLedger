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

  const [lookupId, setLookupId] = useState("");
  const [lookupResult, setLookupResult] = useState<AssetRecord | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      setError("Not authenticated. Connect MetaMask and sign in first.");
      return;
    }
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file to upload.");
      return;
    }
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
        <form onSubmit={handleSubmit} className="space-y-4">
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
