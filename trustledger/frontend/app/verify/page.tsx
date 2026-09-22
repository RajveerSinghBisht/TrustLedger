"use client";

import { useState } from "react";
import { verifyProofBundle, ApiRequestError } from "@/lib/api";
import type { ProofBundle, ProofBundleVerifyResponse } from "@/lib/types";
import {
  Card,
  TextArea,
  Button,
  ErrorBox,
  Badge,
  Spinner,
  EmptyState,
  FadeIn,
} from "@/components/ui";

export default function VerifyPage() {
  const [raw, setRaw] = useState("");
  const [loading, setLoading] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [result, setResult] = useState<ProofBundleVerifyResponse | null>(null);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setParseError(null);
    setApiError(null);
    setResult(null);

    let bundle: ProofBundle;
    try {
      bundle = JSON.parse(raw);
    } catch {
      setParseError("That isn't valid JSON. Paste the exact bundle you copied or downloaded.");
      return;
    }

    setLoading(true);
    try {
      const res = await verifyProofBundle(bundle);
      setResult(res);
    } catch (err) {
      setApiError(
        err instanceof ApiRequestError
          ? `${err.message} (${err.code})`
          : "Verification request failed — check that the backend is reachable."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <div className="text-center space-y-2">
        <p className="inline-block rounded-full bg-(--surface-hover) border border-(--border) px-3 py-1 text-xs text-(--text-muted)">
          No account. No login. No connection to PRAMAAN&apos;s own servers required beyond this check.
        </p>
        <h1 className="text-2xl font-semibold text-(--text-primary)">
          Independently Verify a Proof Bundle
        </h1>
        <p className="text-sm text-(--text-muted) max-w-lg mx-auto">
          Anyone holding a PRAMAAN proof bundle — an auditor, a court, a
          depot, a competitor&apos;s platform — can confirm it here. This
          re-queries the underlying blockchain state directly; it does not
          rely on trusting this specific running instance of PRAMAAN.
        </p>
        <p className="text-xs text-(--text-faint) max-w-lg mx-auto">
          Precisely stated: this is independent <em>online</em> verification —
          it needs network access to a node that can read the chain, it just
          doesn&apos;t need this backend specifically. It is not offline
          verification (that would need a locally held chain checkpoint and
          no network at all — out of scope here).
        </p>
      </div>

      <Card>
        <form onSubmit={handleVerify} className="space-y-4">
          <TextArea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder='{"assetId": 1042, "assetHash": "0x...", "accessedBy": "did:pramaan:...", ...}'
            rows={10}
          />
          <Button type="submit" disabled={loading || !raw.trim()}>
            {loading ? (
              <>
                <Spinner /> Verifying against chain state...
              </>
            ) : (
              "Verify bundle"
            )}
          </Button>
        </form>

        {parseError && (
          <FadeIn className="mt-4">
            <ErrorBox message={parseError} />
          </FadeIn>
        )}
        {apiError && (
          <FadeIn className="mt-4">
            <ErrorBox message={apiError} />
          </FadeIn>
        )}

        {result && (
          <FadeIn className="mt-6">
            <div
              className={`rounded-lg border-2 p-6 text-center ${
                result.valid
                  ? "border-(--success-border) bg-(--success-bg)"
                  : "border-(--danger-border) bg-(--danger-bg)"
              }`}
            >
              <Badge tone={result.valid ? "green" : "red"}>
                {result.valid ? "VALID" : "INVALID"}
              </Badge>
              {result.reason && (
                <p className="mt-2 text-sm text-(--text-primary)">{result.reason}</p>
              )}
              {result.valid && (
                <p className="mt-2 text-xs text-(--text-muted)">
                  Signature checked against the backend&apos;s signing key, and the
                  claimed permission/transaction data was re-confirmed against
                  current chain state.
                </p>
              )}
            </div>
          </FadeIn>
        )}

        {!result && !parseError && !apiError && !loading && (
          <div className="mt-6">
            <EmptyState
              icon={
                <svg
                  className="w-8 h-8 mx-auto"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                  />
                </svg>
              }
              title="No bundle verified yet"
              description="Paste an X-Proof-Bundle JSON payload above and submit to verify cryptographic authenticity on-chain."
            />
          </div>
        )}
      </Card>
    </div>
  );
}
