/**
 * Vault module exports
 */

export {
    readVault,
    writeVault,
    deleteVault,
    decryptVaultToJson,
    isEncryptedVault,
    ensureVaultKey,
    configuredVault,
    type VaultConfig,
} from './vault.js';

export {
    getVaultKey,
    setVaultKey,
    generateVaultKey,
    writeNewKeyFile,
    deleteVaultKey,
    getKeySource,
    isKeychainAvailable,
    isKeyFileAvailable,
    clearKeyCache,
    defaultKeyConfig,
    type KeySource,
    type VaultKeyConfig,
} from './key-provider.js';
