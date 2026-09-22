"use client";

import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { registerIdentity, getIdentity, ApiRequestError } from "@/lib/api";
import { addressToDid } from "@/lib/wallet";
import type { IdentityRecord, Role } from "@/lib/types";
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
  EmptyState,
  FadeIn,
} from "@/components/ui";

const roles: Role[] = ["MANAGER", "AUDITOR", "USER", "ADMIN"];

export default function IdentitiesPage() {
  const { token, claims } = useAuth();

  const [identityAddress, setIdentityAddress] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [role, setRole] = useState<Role>("MANAGER");
  const [displayName, setDisplayName] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(IdentityRecord & { txHash: string }) | null>(null);

  const [lookupDid, setLookupDid] = useState("");
  const [lookupResult, setLookupResult] = useState<IdentityRecord | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  const derivedDid = identityAddress ? addressToDid(identityAddress) : "";

  // UX-only convenience: the JWT's role claim is a coarse routing hint, not
  // an authorization boundary (see BACKEND_SPEC.md — the backend re-checks
  // role fresh from IdentityRegistry for every privileged write, and never
  // trusts this claim itself). Hiding the form for a non-ADMIN JWT just
  // avoids a pointless 401 round trip; it enforces nothing.
  const looksLikeAdmin = claims?.role === "ADMIN";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      setError("Not authenticated. Connect MetaMask and sign in first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await registerIdentity(token, {
        identityAddress,
        did: derivedDid,
        publicKey,
        role,
        displayName,
      });
      setResult(res);
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? `${err.message} (${err.code})`
          : err instanceof Error
          ? err.message
          : "Registration failed."
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
      const res = await getIdentity(lookupDid);
      setLookupResult(res);
    } catch (err) {
      setLookupError(
        err instanceof ApiRequestError
          ? `${err.message} (${err.code})`
          : "Lookup failed."
      );
    } finally {
      setLookupLoading(false);
    }
  }

  return (
    <div className="space-y-8 max-w-3xl mx-auto px-4 py-8">
      <PageHeader
        title="1. Register Identities"
        description="Admin registers a Decentralized Identifier with a role. This calls IdentityRegistry.registerIdentity on-chain and stores the display name in Postgres."
      />

      {!token && (
        <ErrorBox message="Not authenticated. Connect MetaMask and sign the challenge (top right) before registering an identity." />
      )}
      {token && !looksLikeAdmin && (
        <ErrorBox
          message={`Your current session role is ${claims?.role}, not ADMIN. The backend will reject this with 401/403 — this is enforced server-side, not by this warning.`}
        />
      )}

      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field
            label="Identity address"
            hint="The wallet address being registered (e.g. another funded Hardhat account)."
          >
            <Input
              value={identityAddress}
              onChange={(e) => setIdentityAddress(e.target.value)}
              placeholder="0xAbC123..."
              required
            />
          </Field>

          {derivedDid && (
            <Field
              label="Derived DID"
              hint="Decentralized Identifier — constructed automatically from address."
            >
              <Input value={derivedDid} readOnly className="opacity-70" />
            </Field>
          )}

          <Field
            label="Public key"
            hint="Used for challenge-response auth (uncompressed hex, e.g. 0x04...)."
          >
            <Input
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              placeholder="0x04a91..."
              required
            />
          </Field>

          <Field label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Display name" hint="Stored only in Postgres, never on-chain.">
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Officer A"
              required
            />
          </Field>

          <Button type="submit" disabled={submitting || !token}>
            {submitting ? (
              <>
                <Spinner /> Registering...
              </>
            ) : (
              "Register identity"
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
              Identity registered: <Badge>{result.role}</Badge>{" "}
              <Badge tone="green">{result.status}</Badge>
            </SuccessBox>
            <JsonView data={result} />
          </FadeIn>
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-(--text-primary) mb-3">
          Look up an identity
        </h2>
        <p className="text-xs text-(--text-muted) mb-3">
          Public endpoint — no authentication required, per spec.
        </p>
        <form onSubmit={handleLookup} className="flex gap-2">
          <Input
            value={lookupDid}
            onChange={(e) => setLookupDid(e.target.value)}
            placeholder="did:...:0x... or 0x..."
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
                    d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                  />
                </svg>
              }
              title="No identity looked up yet"
              description="Enter a DID above to query registration status on-chain and in Postgres."
            />
          </div>
        )}
      </Card>
    </div>
  );
}
