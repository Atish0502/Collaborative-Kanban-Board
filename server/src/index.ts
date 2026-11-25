import cors from 'cors';
import dotenv from 'dotenv';
import express, { type Express } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase, TaskStore } from './db.js';
import { EventBus } from './events.js';
import { createApiRouter, errorMiddleware } from './routes.js';

for (const candidate of [path.resolve('.env'), path.resolve('../.env')]) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

export type AppOptions = {
  dbPath?: string;
  seed?: boolean;
  corsOrigin?: string;
  serveClient?: boolean;
  failureInjectionEnabled?: boolean;
  failureInjectionRate?: number;
  allowFailureHeader?: boolean;
  heartbeatMs?: number;
};

export function createApp(options: AppOptions = {}): { app: Express; close: () => void } {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const dbPath = options.dbPath ?? process.env.DB_PATH ?? './data/kanban.db';
  const corsOrigin = options.corsOrigin ?? process.env.CORS_ORIGIN ?? 'http://localhost:5173';
  const serveClient =
    options.serveClient ??
    (process.env.SERVE_CLIENT !== undefined
      ? process.env.SERVE_CLIENT === 'true'
      : nodeEnv === 'production');

  const db = openDatabase(dbPath, options.seed ?? true);
  const store = new TaskStore(db);
  const bus = new EventBus(options.heartbeatMs ?? Number(process.env.SSE_HEARTBEAT_MS || 25000));
  bus.start();

  const app = express();
  const allowedOrigins = corsOrigin
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.use(cors({ origin: allowedOrigins.includes('*') ? true : allowedOrigins }));
  app.use(express.json({ limit: '256kb' }));

  app.use(
    '/api',
    createApiRouter(store, bus, {
      failureInjectionEnabled:
        options.failureInjectionEnabled ?? process.env.FAILURE_INJECTION_ENABLED === 'true',
      failureInjectionRate:
        options.failureInjectionRate ??
        Math.min(1, Math.max(0, Number(process.env.FAILURE_INJECTION_RATE || 0))),
      allowFailureHeader:
        options.allowFailureHeader ?? process.env.ALLOW_FAILURE_INJECTION_HEADER !== 'false',
    })
  );

  if (serveClient) {
    const distDir = [path.resolve('client/dist'), path.resolve('../client/dist')].find((d) =>
      fs.existsSync(path.join(d, 'index.html'))
    );
    if (distDir) {
      app.use(express.static(distDir));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api')) return next();
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.use(errorMiddleware);

  return {
    app,
    close: () => {
      bus.stop();
      db.close();
    },
  };
}

const isEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntrypoint) {
  const port = Number(process.env.PORT || 4000);
  const { app, close } = createApp();
  const server = app.listen(port, () => {
    console.log(`Kanban server running on http://localhost:${port}`);
  });

  const stop = () => {
    server.close(() => {
      close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
