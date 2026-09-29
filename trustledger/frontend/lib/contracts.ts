import { Contract, type Signer } from "ethers";
import { getProvider } from "./wallet";
import { API_BASE_URL } from "./api";

const DEFAULT_ACCESS_CONTROL_ADDRESS = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

const ACCESS_CONTROL_ABI = [
  "function requestPermission(uint256 assetId, string calldata subjectDID, uint8 action, uint8 state) external",
  "function approvePermission(uint256 requestId) external",
  "function cancelPermissionRequest(uint256 requestId) external",
  "function getPermissionRequest(uint256 requestId) external view returns (tuple(uint256 requestId, uint256 assetId, string subjectDID, uint8 action, uint8 requestedState, address requester, uint256 requestedAt, uint256 expiresAt, bool approved, bool cancelled))",
  "event PermissionRequested(uint256 indexed requestId, uint256 indexed assetId, string subjectDID, uint8 action, uint8 requestedState, address requester, uint256 expiresAt)",
  "event PermissionApproved(uint256 indexed requestId, address approver)",
  "event PermissionRequestCancelled(uint256 indexed requestId, address cancelledBy)",
];

let cachedAccessControlAddress: string | null = null;

export async function getAccessControlAddress(): Promise<string> {
  if (cachedAccessControlAddress) return cachedAccessControlAddress;
  try {
    const res = await fetch(`${API_BASE_URL}/api/permissions/config`);
    if (res.ok) {
      const data = await res.json();
      if (data.accessControlAddress) {
        cachedAccessControlAddress = data.accessControlAddress;
        return data.accessControlAddress;
      }
    }
  } catch {
    // Fall back to default local deployment address
  }
  return DEFAULT_ACCESS_CONTROL_ADDRESS;
}

export function actionToEnum(action: "READ" | "WRITE" | "TRANSFER"): number {
  switch (action) {
    case "READ":
      return 0;
    case "WRITE":
      return 1;
    case "TRANSFER":
      return 2;
  }
}

export function stateToEnum(state: "GRANTED" | "REVOKED"): number {
  return state === "GRANTED" ? 0 : 1;
}

export async function getAccessControlContract(signer: Signer): Promise<Contract> {
  const address = await getAccessControlAddress();
  return new Contract(address, ACCESS_CONTROL_ABI, signer);
}

/**
 * Submits requestPermission directly from the officer's connected MetaMask wallet.
 * Ensures msg.sender on-chain is the real Officer 1, satisfying dual-custody identity.
 */
export async function requestPermissionOnChain(
  assetId: number,
  subjectDID: string,
  action: "READ" | "WRITE" | "TRANSFER",
  state: "GRANTED" | "REVOKED" = "GRANTED"
): Promise<{
  txHash: string;
  requestId: number;
  expiresAt: number;
  requester: string;
}> {
  const provider = await getProvider();
  const signer = await provider.getSigner();
  const contract = await getAccessControlContract(signer);

  const tx = await contract.requestPermission(
    assetId,
    subjectDID,
    actionToEnum(action),
    stateToEnum(state)
  );
  const receipt = await tx.wait();

  let requestId = 0;
  let expiresAt = Math.floor(Date.now() / 1000) + 86400;
  if (receipt && receipt.logs) {
    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        if (parsed?.name === "PermissionRequested") {
          requestId = Number(parsed.args.requestId);
          expiresAt = Number(parsed.args.expiresAt);
          break;
        }
      } catch {
        continue;
      }
    }
  }

  const requester = await signer.getAddress();
  return { txHash: receipt ? receipt.hash : "", requestId, expiresAt, requester };
}

/**
 * Submits approvePermission directly from Officer 2's connected MetaMask wallet.
 * The contract strictly verifies that msg.sender != request.requester on-chain.
 */
export async function approvePermissionOnChain(
  requestId: number
): Promise<{ txHash: string }> {
  const provider = await getProvider();
  const signer = await provider.getSigner();
  const contract = await getAccessControlContract(signer);

  const tx = await contract.approvePermission(requestId);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/**
 * Cancels a pending permission request directly on-chain from the requester's or Admin's wallet.
 */
export async function cancelPermissionRequestOnChain(
  requestId: number
): Promise<{ txHash: string }> {
  const provider = await getProvider();
  const signer = await provider.getSigner();
  const contract = await getAccessControlContract(signer);

  const tx = await contract.cancelPermissionRequest(requestId);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}
