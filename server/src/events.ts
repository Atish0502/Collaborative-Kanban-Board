import crypto from 'node:crypto';
import type { Response } from 'express';
import type { BoardEvent } from './types.js';

export class EventBus {
  private clients = new Map<string, Response>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private heartbeatMs = 25000) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const ping = `:heartbeat ${new Date().toISOString()}\n\n`;
      for (const [key, res] of this.clients) {
        try {
          res.write(ping);
        } catch {
          this.clients.delete(key);
        }
      }
    }, this.heartbeatMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const res of this.clients.values()) {
      try {
        res.end();
      } catch {
        // stream already closed
      }
    }
    this.clients.clear();
  }

  count(): number {
    return this.clients.size;
  }

  subscribe(clientId: string, res: Response): () => void {
    const key = `${clientId}:${crypto.randomUUID()}`;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write('retry: 2000\n\n');

    this.clients.set(key, res);

    this.send(res, 'connected', crypto.randomUUID(), {
      clientId,
      connectedClients: this.clients.size,
      timestamp: new Date().toISOString(),
    });
    this.broadcastRaw('clients.count', {
      connectedClients: this.clients.size,
      timestamp: new Date().toISOString(),
    });

    return () => {
      if (this.clients.delete(key)) {
        this.broadcastRaw('clients.count', {
          connectedClients: this.clients.size,
          timestamp: new Date().toISOString(),
        });
      }
    };
  }

  emit(
    event: BoardEvent extends infer U ? (U extends BoardEvent ? Omit<U, 'eventId' | 'timestamp'> : never) : never
  ): void {
    const full = {
      ...event,
      eventId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    } as BoardEvent;
    this.broadcastRaw(full.type, full, full.eventId);
  }

  private broadcastRaw(name: string, payload: unknown, id: string = crypto.randomUUID()): void {
    for (const [key, res] of this.clients) {
      try {
        this.send(res, name, id, payload);
      } catch {
        this.clients.delete(key);
      }
    }
  }

  private send(res: Response, name: string, id: string, payload: unknown): void {
    res.write(`id: ${id}\nevent: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
  }
}
