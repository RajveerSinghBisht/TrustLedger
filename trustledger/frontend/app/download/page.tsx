"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { downloadAsset, ApiRequestError } from "@/lib/api";
import type { ProofBundle } from "@/lib/types";
import {
  Card,
  PageHeader,
  Field,
  Input,
  Button,
  JsonView,
  ErrorBox,
  SuccessBox,
  Spinner,
  FadeIn,
} from "@/components/ui";

export default function DownloadPage() {
  const { token } = useAuth();
  const [assetId, setAssetId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proofBundle, setProofBundle] = useState<ProofBundle | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleDownload(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      setError("Not authenticated. Connect MetaMask and sign in as the subject who was granted access.");
      return;
    }
    setLoading(true);
    setError(null);
    setProofBundle(null);
    setFilename(null);
    setCopied(false);
    try {
      const { blob, filename: fname, proofBundle: bundle } = await downloadAsset(
        token,
        Number(assetId)
      );
      setProofBundle(bundle);
      setFilename(fname);

      // Trigger the actual file save separately from reading the header —
      // a plain <a href> can't read X-Proof-Bundle, so we fetch, read the
      // header ourselves, then construct the save via Blob + object URL.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fname ?? `asset-${assetId}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.code === "FORBIDDEN" || err.status === 403
            ? `Access denied (403). AccessControl.checkPermissionNow rejected this — either no READ permission was granted to this identity, it was revoked, or this identity is not ACTIVE. (${err.code})`
            : `${err.message} (${err.code})`
          : err instanceof Error
          ? err.message
          : "Download failed."
      );
    } finally {
      setLoading(false);
    }
  }

  async function copyBundle() {
    if (!proofBundle) return;
    await navigator.clipboard.writeText(JSON.stringify(proofBundle, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-8 max-w-3xl mx-auto px-4 py-8">
      <PageHeader
        title="4. Download as Granted Subject"
        description="Sign in as the identity that was just granted READ access, then download. The file save and the proof bundle are two separate things this screen surfaces — a plain download link would hide the X-Proof-Bundle header entirely."
      />

      {!token && (
        <ErrorBox message="Not authenticated. Switch MetaMask accounts to the subject that was granted access, then connect and sign in." />
      )}

      <Card>
        <form onSubmit={handleDownload} className="space-y-4">
          <Field label="Asset ID">
            <Input
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              placeholder="1042"
              type="number"
            />
          </Field>
          <Button type="submit" disabled={loading || !token}>
            {loading ? (
              <>
                <Spinner /> Checking access & downloading...
              </>
            ) : (
              "Download"
            )}
          </Button>
        </form>

        {error && (
          <FadeIn className="mt-4">
            <ErrorBox message={error} />
          </FadeIn>
        )}
      </Card>

      {proofBundle && (
        <FadeIn>
          <Card>
            <SuccessBox>
              File downloaded{filename ? ` as "${filename}"` : ""}. Access was
              authorized by <strong>AccessControl.checkPermissionNow</strong>{" "}
              and recorded on-chain as an <code>AssetAccessed</code> event.
            </SuccessBox>

            <h2 className="mt-4 text-sm font-semibold text-(--text-primary)">
              Proof Bundle (from <code>X-Proof-Bundle</code> response header)
            </h2>
            <p className="text-xs text-(--text-muted) mt-1 mb-3">
              This is what the backend attests happened. It is independently
              checkable by anyone — take it to the Verify Bundle screen, in a
              different tab, with no login required.
            </p>
            <JsonView data={proofBundle} />

            <div className="mt-4 flex gap-3">
              <Button variant="secondary" onClick={copyBundle}>
                {copied ? "Copied!" : "Copy bundle JSON"}
              </Button>
              <Link href="/verify">
                <Button variant="secondary">Go verify this bundle →</Button>
              </Link>
            </div>
          </Card>
        </FadeIn>
      )}
    </div>
  );
}
