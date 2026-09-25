"use client";

import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { registerIdentity, getIdentity, updateIdentityDisplayName, ApiRequestError } from "@/lib/api";
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

  const [editName, setEditName] = useState("");
  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateSuccess, setUpdateSuccess] = useState<string | null>(null);

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
      // Reset form fields cleanly upon successful registration
      setIdentityAddress("");
      setPublicKey("");
      setDisplayName("");
      setRole("MANAGER");
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
    setUpdateError(null);
    setUpdateSuccess(null);
    try {
      const res = await getIdentity(lookupDid);
      setLookupResult(res);
      setEditName(res.displayName ?? "");
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

  async function handleUpdateName(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      setUpdateError("Not authenticated. Connect wallet and sign in first.");
      return;
    }
    const targetDid = lookupResult?.did || lookupDid;
    if (!targetDid || !editName.trim()) {
      setUpdateError("Target DID and new display name are required.");
      return;
    }
    setUpdateLoading(true);
    setUpdateError(null);
    setUpdateSuccess(null);
    try {
      const updated = await updateIdentityDisplayName(token, targetDid, editName.trim());
      setLookupResult(updated);
      setUpdateSuccess(`Display name successfully updated off-chain to "${updated.displayName}".`);
    } catch (err) {
      setUpdateError(
        err instanceof ApiRequestError
          ? `${err.message} (${err.code})`
          : err instanceof Error
          ? err.message
          : "Update failed."
      );
    } finally {
      setUpdateLoading(false);
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
          <FadeIn className="mt-4 space-y-4">
            <JsonView data={lookupResult} />

            {token && (
              <div className="rounded-lg border border-(--border) bg-(--surface)/70 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-(--text-primary)">
                    Rename Off-Chain Display Name
                  </h3>
                  <span className="text-[10px] font-mono text-(--text-muted) px-2 py-0.5 rounded border border-(--border) bg-(--bg)">
                    PostgreSQL Metadata
                  </span>
                </div>
                <p className="text-xs text-(--text-muted)">
                  Display names are stored off-chain in Postgres to preserve privacy. Admins (or the active identity owner) can rename identities anytime.
                </p>
                {lookupResult.did.toLowerCase().includes("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266") ? (
                  <div className="flex items-center gap-2.5 p-3 rounded-md bg-(--surface) border border-(--border) text-xs font-mono text-(--text-muted)">
                    <span className="text-base">🔒</span>
                    <div>
                      <span className="font-semibold text-(--text-primary)">Root Admin (Account #0)</span>
                      <p className="text-[11px] text-(--text-muted) mt-0.5">
                        This is the genesis bootstrap deployer identity. Its name and credentials are cryptographically immutable and cannot be renamed.
                      </p>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleUpdateName} className="flex flex-col sm:flex-row gap-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Enter new display name"
                      required
                      className="flex-1"
                    />
                    <Button type="submit" disabled={updateLoading || !editName.trim()}>
                      {updateLoading ? (
                        <>
                          <Spinner /> Saving...
                        </>
                      ) : (
                        "Save Name"
                      )}
                    </Button>
                  </form>
                )}
                {updateError && <ErrorBox message={updateError} />}
                {updateSuccess && <SuccessBox>{updateSuccess}</SuccessBox>}
              </div>
            )}
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
