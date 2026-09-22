import { randomBytes } from "crypto";
import { ethers } from "ethers";
import jwt from "jsonwebtoken";
import { getConfig } from "../config";
import {
  AuthChallengeRepository,
  ChallengeAlreadyConsumedOrMissingError,
} from "../repositories/authChallenge";
import {
  getRole,
  isActive,
  resolveDID,
} from "./identityRegistryService";

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const JWT_TTL_SECONDS = 15 * 60;

export type JwtRole = "ADMIN" | "MANAGER" | "AUDITOR" | "USER";

export interface ChallengeResponse {
  message: string;
  expiresAt: string;
}

export interface VerifyAuthInput {
  did: string;
  message: string;
  signature: string;
}

export interface VerifyAuthResponse {
  token: string;
  expiresAt: string;
}

export interface AuthServiceDependencies {
  challengeRepository: AuthChallengeRepository;
  now?: () => Date;
}

function canonicalMessage(input: {
  domain: string;
  did: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}): string {
  return [
    "PRAMAAN Authentication Request",
    "",
    `Domain: ${input.domain}`,
    "Purpose: Authenticate to PRAMAAN backend",
    `DID: ${input.did}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt.toISOString()}`,
    `Expiration: ${input.expiresAt.toISOString()}`,
  ].join("\n");
}

function extractNonce(message: string): string | null {
  const matches = message.match(/^Nonce: ([0-9a-fA-F]+)$/gm);
  return matches && matches.length === 1 ? matches[0].slice("Nonce: ".length) : null;
}

function roleFromContractValue(value: unknown): JwtRole {
  const numeric = Number(value);
  const roles: Record<number, JwtRole> = {
    1: "ADMIN",
    2: "MANAGER",
    3: "AUDITOR",
    4: "USER",
  };
  const role = roles[numeric];
  if (!role) {
    throw new Error(`Cannot issue JWT for unsupported on-chain role: ${String(value)}`);
  }
  return role;
}

export function buildCanonicalAuthMessage(
  did: string,
  nonce: string,
  issuedAt: Date,
  expiresAt: Date,
  domain: string
): string {
  return canonicalMessage({ domain, did, nonce, issuedAt, expiresAt });
}

export function createAuthService(deps: AuthServiceDependencies) {
  const now = deps.now ?? (() => new Date());

  return {
    async createChallenge(did: string): Promise<ChallengeResponse> {
      const config = getConfig();
      const expectedAddress = await resolveDID(did);

      if (expectedAddress === ethers.ZeroAddress) {
        const error = new Error("Unknown DID");
        (error as Error & { code?: string }).code = "DID_NOT_FOUND";
        throw error;
      }

      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
      const nonce = randomBytes(16).toString("hex");

      await deps.challengeRepository.create({
        nonce,
        did,
        expectedAddress,
        issuedAt,
        expiresAt,
      });

      return {
        message: canonicalMessage({
          domain: config.authDomain,
          did,
          nonce,
          issuedAt,
          expiresAt,
        }),
        expiresAt: expiresAt.toISOString(),
      };
    },

    async verify(input: VerifyAuthInput): Promise<VerifyAuthResponse> {
      const config = getConfig();
      const nonce = extractNonce(input.message);
      if (!nonce) throw unauthorized();

      const challenge = await deps.challengeRepository.findByNonce(nonce);
      if (!challenge || challenge.consumed || challenge.expiresAt.getTime() <= now().getTime()) {
        throw unauthorized();
      }

      if (challenge.did !== input.did) throw unauthorized();

      const expectedMessage = canonicalMessage({
        domain: config.authDomain,
        did: challenge.did,
        nonce: challenge.nonce,
        issuedAt: challenge.issuedAt,
        expiresAt: challenge.expiresAt,
      });
      if (input.message !== expectedMessage) throw unauthorized();

      let recoveredAddress: string;
      try {
        recoveredAddress = ethers.verifyMessage(expectedMessage, input.signature);
      } catch {
        throw unauthorized();
      }

      if (ethers.getAddress(recoveredAddress) !== ethers.getAddress(challenge.expectedAddress)) {
        throw unauthorized();
      }

      if (!(await isActive(challenge.expectedAddress))) throw unauthorized();

      const role = roleFromContractValue(await getRole(challenge.expectedAddress));
      const issuedAtSeconds = Math.floor(now().getTime() / 1000);
      const expiresAtSeconds = issuedAtSeconds + JWT_TTL_SECONDS;

      try {
        await deps.challengeRepository.consumeIfUnconsumed(challenge.nonce);
      } catch (error) {
        if (error instanceof ChallengeAlreadyConsumedOrMissingError) throw unauthorized();
        throw error;
      }

      // OWASP: use the dedicated JWT signing secret (config.jwtSecret),
      // NOT backendSigningPrivateKey directly. jwtSecret defaults to
      // backendSigningPrivateKey for backward compatibility but can be
      // set independently via JWT_SECRET env var.
      const token = jwt.sign(
        {
          did: challenge.did,
          address: challenge.expectedAddress,
          role,
          iat: issuedAtSeconds,
          exp: expiresAtSeconds,
        },
        config.jwtSecret,
        { algorithm: "HS256"}
      );

      return {
        token,
        expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      };
    },
  };
}

function unauthorized(): Error {
  const error = new Error("Authentication failed");
  (error as Error & { code?: string }).code = "AUTHENTICATION_FAILED";
  return error;
}
