/**
 * Application - Shared initialization layer for CLI and API
 *
 * Handles authentication, persistence, and client setup once,
 * providing a unified context for both CLI and API modes.
 */

import { existsSync } from 'fs';
import { getConversationsConfig, authConfig, mockConfig } from './config.js';
import { logger } from './logger.js';
import { resolveDataPath } from './paths.js';
import { LumoClient } from '../lumo-client/index.js';
import { createAuthProvider, AuthManager, type AuthProvider, type ProtonApi } from '../auth/index.js';
import { getConversationStore, getFallbackStore, setConversationStore, type ConversationStore, initializeSync, initializeConversationStore, FallbackStore } from '../conversations/index.js';
import { createMockProtonApi } from '../mock/mock-api.js';
import { installFetchAdapter } from '../shims/fetch-adapter.js';
import { suppressFullApiErrors } from '../shims/console.js';

function isRecoverableAuthError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /Vault not found|No secure key storage|Cannot generate vault key|Failed to decrypt vault|Vault key file |Invalid vault key|Key file exists but is invalid|is a directory|Token file missing|wrong key or corrupted|Run: tamer auth/i.test(msg);
}

export class Application {
  private lumoClient?: LumoClient;
  private authProvider?: AuthProvider;
  private authManager?: AuthManager;
  private protonApi?: ProtonApi;
  private uid?: string;
  private syncInitialized = false;
  private cleanupFetchAdapter?: () => void;

  /**
   * Create and initialize the application
   */
  static async create(options: { allowMissingVault?: boolean } = {}): Promise<Application> {
    const app = new Application();
    if (mockConfig.enabled) {
      await app.initializeMock();
      return app;
    }
    if (!options.allowMissingVault) {
      await app.bootAuthenticated();
      return app;
    }
    if (!app.vaultExists()) {
      app.initializeUnauthenticated('No auth vault. Open /auth in a browser to log in.');
      return app;
    }
    try {
      await app.bootAuthenticated();
    } catch (error) {
      if (!isRecoverableAuthError(error)) throw error;
      app.initializeUnauthenticated(
        'Auth vault is unusable (missing key or cannot decrypt). Open /auth to log in again.',
      );
      logger.warn({ error }, 'Skipped broken vault; waiting for /auth');
    }
    return app;
  }

  private vaultExists(): boolean {
    return existsSync(resolveDataPath(authConfig.vault.path));
  }

  private initializeUnauthenticated(reason: string): void {
    setConversationStore(getFallbackStore());
    logger.warn(reason);
  }

  private dropSession(): void {
    this.authManager?.destroy();
    this.cleanupFetchAdapter?.();
    this.cleanupFetchAdapter = undefined;
    this.authManager = undefined;
    this.authProvider = undefined;
    this.protonApi = undefined;
    this.lumoClient = undefined;
    this.uid = undefined;
    this.syncInitialized = false;
  }

  private async bootAuthenticated(): Promise<void> {
    await this.initializeAuth();
    await this.initializeStore();
    await this.initializeSync();
  }

  isAuthenticated(): boolean {
    if (mockConfig.enabled && this.lumoClient) return true;
    return !!this.authManager && !!this.lumoClient;
  }

  /**
   * Drop the in-memory session after /auth logout. Vault is already deleted.
   */
  clearAuth(): void {
    this.dropSession();
    this.initializeUnauthenticated('Signed out. Open /auth to log in again.');
  }

  /**
   * Load a vault written by /auth or `tamer auth` without restarting.
   */
  async applyVaultAuth(): Promise<void> {
    this.dropSession();
    await this.bootAuthenticated();
  }

  /**
   * Initialize mock mode - bypass auth, use simulated API responses
   */
  private async initializeMock(): Promise<void> {
    const conversationsConfig = getConversationsConfig();

    if (!conversationsConfig.useFallbackStore) {
      // Use primary store with fake-indexeddb
      const { initializeMockStore } = await import('../mock/mock-store.js');
      const result = await initializeMockStore();
      setConversationStore(result.conversationStore);
    } else {
      // Use fallback in-memory store
      setConversationStore(getFallbackStore());
    }

    this.protonApi = createMockProtonApi(mockConfig.scenario);
    this.lumoClient = new LumoClient(this.protonApi, { enableEncryption: false });

    logger.info({
      scenario: mockConfig.scenario,
      useFallbackStore: conversationsConfig.useFallbackStore,
    }, 'Mock mode active - auth and sync bypassed');
  }

  /**
   * Initialize authentication using AuthManager with auto-refresh
   */
  private async initializeAuth(): Promise<void> {
    this.authProvider = await createAuthProvider();

    // Create AuthManager with auto-refresh configuration
    const vaultPath = resolveDataPath(authConfig.vault.path);
    const autoRefreshConfig = authConfig.autoRefresh;

    this.authManager = new AuthManager({
      provider: this.authProvider,
      vaultPath,
      autoRefresh: {
        enabled: autoRefreshConfig.enabled,
        intervalHours: autoRefreshConfig.intervalHours,
        onError: autoRefreshConfig.onError,
      },
    });

    // Create API with 401 refresh handling
    this.protonApi = this.authManager.createApi();
    this.uid = this.authProvider.getUid();
    this.lumoClient = new LumoClient(this.protonApi);

    // Install fetch adapter for upstream LumoApi
    // fullApiSupported is false for login/rclone auth (no lumo scope)
    const fullApiSupported = this.authProvider.supportsFullApi();
    this.cleanupFetchAdapter = installFetchAdapter(this.protonApi, fullApiSupported);

    // Configure console shim to suppress API errors when full api is not supported
    suppressFullApiErrors(!fullApiSupported);

    // Start scheduled auto-refresh
    this.authManager.startAutoRefresh();

    logger.info({ method: this.authProvider.method }, 'Authentication initialized with auto-refresh');
  }

  /**
   * Initialize conversation store (upstream or fallback in-memory)
   */
  private async initializeStore(): Promise<void> {
    const conversationsConfig = getConversationsConfig();
    const protonApi = this.protonApi;
    const uid = this.uid;
    const authProvider = this.authProvider;
    if (!protonApi || !uid || !authProvider) {
      throw new Error('Auth not initialized');
    }
    await initializeConversationStore({
      protonApi,
      uid,
      authProvider,
      conversationsConfig,
    });
  }

  /**
   * Initialize sync service for conversation persistence
   */
  private async initializeSync(): Promise<void> {
    const conversationsConfig = getConversationsConfig();
    const protonApi = this.protonApi;
    const uid = this.uid;
    const authProvider = this.authProvider;
    if (!protonApi || !uid || !authProvider) {
      throw new Error('Auth not initialized');
    }
    const result = await initializeSync({
      protonApi,
      uid,
      authProvider,
      conversationsConfig,
    });
    this.syncInitialized = result.initialized;
  }

  // AppContext implementation

  getLumoClient(): LumoClient {
    if (!this.lumoClient) {
      throw new Error('Not authenticated. Open /auth or run: tamer auth');
    }
    return this.lumoClient;
  }

  getConversationStore(): ConversationStore | FallbackStore {
    return getConversationStore();
  }

  getAuthProvider(): AuthProvider | undefined {
    return this.authProvider;
  }

  getAuthManager(): AuthManager | undefined {
    return this.authManager;
  }

  isSyncInitialized(): boolean {
    return this.syncInitialized;
  }

  /**
   * Cleanup resources on shutdown
   */
  destroy(): void {
    this.authManager?.destroy();
    this.cleanupFetchAdapter?.();
  }
}

