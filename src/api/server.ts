import { spawn } from 'child_process';
import { existsSync, readFileSync, utimesSync } from 'fs';
import express from 'express';
import { getServerConfig, getMetricsConfig, authConfig } from '../app/config.js';
import { resolveDataPath } from '../app/paths.js';
import { logger } from '../app/logger.js';
import { setupAuthMiddleware, setupLoggingMiddleware, setupMetricsMiddleware, setupReadyMiddleware } from './middleware.js';
import { setupApiErrorHandler } from './error-handler.js';
import { createHealthRouter } from './routes/health.js';
import { createModelsRouter } from './routes/models.js';
import { createChatCompletionsRouter } from './routes/chat-completions/index.js';
import { createResponsesRouter } from './routes/responses/index.js';
import { createAuthRouter } from './routes/auth.js';
import { createConfigRouter } from './routes/config.js';
import { EndpointDependencies } from './types.js';
import { RequestQueue } from './queue.js';
import { initMetrics, type MetricsService } from '../app/metrics.js';
import { createMetricsRouter } from './routes/metrics.js';
import type { Application } from '../app/index.js';
import { VERSION } from '../app/version.js';

export class APIServer {
  private expressApp: express.Application;
  private serverConfig = getServerConfig();
  private queue = new RequestQueue(1); // Process one request at a time
  private metrics: MetricsService | null = null;
  private deps: EndpointDependencies;

  constructor(private app: Application) {
    this.expressApp = express();
    const metricsConfig = getMetricsConfig();
    if (metricsConfig.enabled) {
      this.metrics = initMetrics(metricsConfig);
    }
    this.deps = this.buildDependencies();
    this.app.setOnSessionInvalid(() => {
      this.refreshAuthBindings();
      logger.warn('Session invalidated after 401; waiting for /auth');
    });
    this.setupMiddleware();
    this.setupRoutes();
  }

  refreshAuthBindings(): void {
    Object.assign(this.deps, this.buildDependencies());
  }

  private setupMiddleware(): void {
    this.expressApp.use(express.json({ limit: this.serverConfig.bodyLimit }));
    this.expressApp.use(express.urlencoded({ extended: false }));
    this.expressApp.use(setupAuthMiddleware(this.serverConfig.apiKey));
    this.expressApp.use(setupReadyMiddleware(() => this.app.isAuthenticated()));
    this.expressApp.use(setupLoggingMiddleware());
    if (this.metrics) {
      this.expressApp.use(setupMetricsMiddleware(this.metrics));
    }
  }

  private setupRoutes(): void {
    if (this.metrics) {
      this.expressApp.use(createMetricsRouter(this.metrics));
    }

    this.expressApp.use(createHealthRouter(this.deps));
    this.expressApp.use(createModelsRouter());
    this.expressApp.use(createChatCompletionsRouter(this.deps));
    this.expressApp.use(createResponsesRouter(this.deps));
    this.expressApp.use(createAuthRouter(this.deps, {
      onAuthenticated: async () => {
        await this.app.applyVaultAuth();
        this.refreshAuthBindings();
        logger.info('Auth vault loaded into the running server');
      },
      onLoggedOut: () => {
        this.app.clearAuth();
        this.refreshAuthBindings();
        logger.info('Signed out; waiting for /auth');
      },
    }));
    this.expressApp.use(createConfigRouter(this.app, {
      onSaved: () => {
        restartAfterConfigSave();
      },
    }));

    this.expressApp.use(setupApiErrorHandler());
  }

  private buildDependencies(): EndpointDependencies {
    const vaultPath = resolveDataPath(authConfig.vault.path);

    return {
      queue: this.queue,
      lumoClient: this.app.isAuthenticated() ? this.app.getLumoClient() : undefined,
      conversationStore: this.app.getConversationStore(),
      syncInitialized: this.app.isSyncInitialized(),
      authManager: this.app.getAuthManager(),
      vaultPath,
    };
  }

  async start(): Promise<void> {
    const { validateTemplateOnce } = await import('./instructions.js');
    validateTemplateOnce(this.serverConfig.instructions.template);

    return new Promise((resolve) => {
      this.expressApp.listen(this.serverConfig.port, () => {
        logger.info('========================================');
        logger.info(`lumo-tamer v${VERSION} is ready!`);
        logger.info(`  base_url: http://localhost:${this.serverConfig.port}/v1`);
        logger.info(`  auth:     http://localhost:${this.serverConfig.port}/auth`);
        logger.info(`  config:   http://localhost:${this.serverConfig.port}/config`);
        logger.info(`  api_key:  ${this.serverConfig.apiKey.substring(0, 3)}...`);
        if (!this.app.isAuthenticated()) {
          logger.warn('Not logged in yet. Open /auth and sign in to Proton.');
        }
        logger.info('========================================\n');
        resolve();
      });
    });
  }
}

/** Docker/k8s restart the PID. Local `tsx watch` only restarts on file changes. */
function restartAfterConfigSave(): void {
  logger.info('Restart triggered — shutting down...');
  if (existsSync('/.dockerenv') || process.env.KUBERNETES_SERVICE_HOST) {
    process.exit(0);
  }
  if (parentIsTsxWatch()) {
    try {
      const entry = process.argv[1];
      if (entry) utimesSync(entry, new Date(), new Date());
      logger.info('Poked tsx watch — waiting for restart');
    } catch (err) {
      logger.warn({ err }, 'Could not poke tsx watch, respawning');
      respawnSelf();
    }
    process.exit(0);
  }
  logger.info('Not in Docker/tsx-watch — respawning self');
  respawnSelf();
  process.exit(0);
}

function parentIsTsxWatch(): boolean {
  try {
    const cmd = readFileSync(`/proc/${process.ppid}/cmdline`, 'utf8');
    return cmd.includes('tsx') && cmd.includes('watch');
  } catch {
    return false;
  }
}

function respawnSelf(): void {
  const args = [
    ...process.execArgv,
    ...process.argv.slice(1).filter((arg) => arg !== 'watch'),
  ];
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'inherit',
    env: process.env,
  });
  child.unref();
}
