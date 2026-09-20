import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { getConfig } from "../config";

/**
 * Two-tier document encryption per BACKEND_SPEC.md's Key Management
 * section: each asset's file bytes are encrypted with a unique, random
 * per-asset AES-256-GCM data key; that data key is itself "wrapped"
 * (encrypted) under a single backend-held master key
 * (DOCUMENT_MASTER_KEY), and only the wrapped ciphertext is persisted.
 * The raw per-asset key exists only transiently in memory during
 * encrypt/decrypt and is never persisted — this module never returns an
 * unwrapped data key to a caller that would then store it.
 *
 * Master key format: DOCUMENT_MASTER_KEY is expected to be a 64-character
 * hex string (32 raw bytes) — confirmed against the actual value present
 * in backend/.env at the time this was written. This is NOT explicitly
 * pinned down in BACKEND_SPEC.md's prose (it only says what the key is
 * USED for, not its exact encoding), so this module validates the
 * decoded length explicitly and throws a clear, specific error at
 * getMasterKey() call time if it's wrong — rather than silently running
 * a KDF over an unexpected format and producing a working-but-different
 * key that would make every previously-encrypted document undecryptable
 * after a config change nobody would notice was wrong until a download
 * failed.
 */

const AES_KEY_BYTES = 32; // AES-256
const GCM_IV_BYTES = 12; // 96-bit IV, the standard/recommended size for GCM
const GCM_AUTH_TAG_BYTES = 16;

let cachedMasterKey: Buffer | null = null;

function getMasterKey(): Buffer {
  if (!cachedMasterKey) {
    const config = getConfig();
    const raw = config.documentMasterKey.trim();

    if (!/^[0-9a-fA-F]+$/.test(raw)) {
      throw new Error(
        "DOCUMENT_MASTER_KEY must be a hex-encoded string (got non-hex characters)."
      );
    }

    const decoded = Buffer.from(raw, "hex");

    if (decoded.length !== AES_KEY_BYTES) {
      throw new Error(
        `DOCUMENT_MASTER_KEY must decode to exactly ${AES_KEY_BYTES} bytes ` +
          `(64 hex characters) for AES-256 — got ${decoded.length} bytes.`
      );
    }

    cachedMasterKey = decoded;
  }
  return cachedMasterKey;
}

export interface EncryptedPayload {
  encryptedBlob: Buffer;
  iv: Buffer;
  authTag: Buffer;
  wrappedDataKey: Buffer;
}

/**
 * Encrypts `plaintext` with a freshly generated random per-asset AES-256
 * key, then wraps (encrypts) that data key under the master key so it
 * can be safely persisted. The random per-asset key itself is never
 * returned to the caller — only its wrapped form. Two independent random
 * IVs are used: one for the data encryption, one for the key-wrapping
 * step, since GCM's security guarantee requires a unique IV per
 * encryption under a given key, and the same master key is (or will be)
 * reused across every asset's key-wrapping call.
 */
export function encryptDocument(plaintext: Buffer): EncryptedPayload {
  const masterKey = getMasterKey();

  // Generate the per-asset data key. Exists only in this function's
  // local scope — never returned, never logged, never persisted.
  const dataKey = randomBytes(AES_KEY_BYTES);

  // Encrypt the actual file bytes with the per-asset data key.
  const dataIv = randomBytes(GCM_IV_BYTES);
  const dataCipher = createCipheriv("aes-256-gcm", dataKey, dataIv);
  const encryptedBlob = Buffer.concat([
    dataCipher.update(plaintext),
    dataCipher.final(),
  ]);
  const authTag = dataCipher.getAuthTag();

  // Wrap the per-asset data key under the master key. The wrapping IV is
  // prepended to the wrapped ciphertext (along with its own auth tag) so
  // unwrapDataKey below is self-contained and doesn't need a second
  // column in the database for a second IV.
  const wrapIv = randomBytes(GCM_IV_BYTES);
  const wrapCipher = createCipheriv("aes-256-gcm", masterKey, wrapIv);
  const wrappedKeyCiphertext = Buffer.concat([
    wrapCipher.update(dataKey),
    wrapCipher.final(),
  ]);
  const wrapAuthTag = wrapCipher.getAuthTag();

  const wrappedDataKey = Buffer.concat([
    wrapIv,
    wrapAuthTag,
    wrappedKeyCiphertext,
  ]);

  return { encryptedBlob, iv: dataIv, authTag, wrappedDataKey };
}

/**
 * Reverses encryptDocument(): unwraps the per-asset data key from
 * `wrappedDataKey` using the master key, uses it to decrypt
 * `encryptedBlob`, and returns the original plaintext. The unwrapped
 * data key exists only in this function's local scope during the call —
 * it is discarded (eligible for GC) as soon as this function returns,
 * per BACKEND_SPEC.md's "do not cache or persist the unwrapped key"
 * requirement. There is no module-level cache of any per-asset data key
 * anywhere in this file.
 */
export function decryptDocument(payload: {
  encryptedBlob: Buffer;
  iv: Buffer;
  authTag: Buffer;
  wrappedDataKey: Buffer;
}): Buffer {
  const masterKey = getMasterKey();

  const wrapIv = payload.wrappedDataKey.subarray(0, GCM_IV_BYTES);
  const wrapAuthTag = payload.wrappedDataKey.subarray(
    GCM_IV_BYTES,
    GCM_IV_BYTES + GCM_AUTH_TAG_BYTES
  );
  const wrappedKeyCiphertext = payload.wrappedDataKey.subarray(
    GCM_IV_BYTES + GCM_AUTH_TAG_BYTES
  );

  const wrapDecipher = createDecipheriv("aes-256-gcm", masterKey, wrapIv);
  wrapDecipher.setAuthTag(wrapAuthTag);
  const dataKey = Buffer.concat([
    wrapDecipher.update(wrappedKeyCiphertext),
    wrapDecipher.final(),
  ]);

  const dataDecipher = createDecipheriv(
    "aes-256-gcm",
    dataKey,
    payload.iv
  );
  dataDecipher.setAuthTag(payload.authTag);
  return Buffer.concat([
    dataDecipher.update(payload.encryptedBlob),
    dataDecipher.final(),
  ]);
}

/** For tests only: clears the cached master key. */
export function _resetDocumentEncryptionForTests(): void {
  cachedMasterKey = null;
}
