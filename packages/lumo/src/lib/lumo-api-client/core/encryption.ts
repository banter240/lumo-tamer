import { decryptString, decryptUint8Array, encryptString } from '../../../crypto';
import { LUMO_GPG_PUB_KEY } from '../../../keys';
import type { RequestEncryptionParams } from './encryptionParams';
import type { EncryptedTurn, Turn } from './types';

// Default Lumo public key (uses production key or custom key from LUMO_PUB_KEY_PATH env var)
export const DEFAULT_LUMO_PUB_KEY = LUMO_GPG_PUB_KEY;

export { decryptString, decryptUint8Array, encryptString };

/**
 * Encrypt one conversation turn for U2L encryption
 */
async function encryptTurn(turn: Turn, encryption: RequestEncryptionParams) {
    const content = turn.content ?? '';
    const encryptedTurn: EncryptedTurn = {
        ...turn,
        content: await encryption.encryptString(content),
        encrypted: true,
    };
    return encryptedTurn;
}

/**
 * Encrypt all conversation turns for U2L encryption
 */
export async function encryptTurns(turns: Turn[], encryption: RequestEncryptionParams): Promise<EncryptedTurn[]> {
    return Promise.all(turns.map((turn) => encryptTurn(turn, encryption)));
}
