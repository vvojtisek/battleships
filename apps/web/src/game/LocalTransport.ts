import type { Transport } from '@bs/protocol';
import type { WorkerCommand, WorkerEvent } from './messages.js';

export class LocalTransport implements Transport<WorkerCommand, WorkerEvent> {
  readonly status = 'open' as const;
  private readonly worker = new Worker(new URL('./game.worker.ts', import.meta.url), {
    type: 'module',
  });
  private readonly handlers = new Set<(event: WorkerEvent) => void>();

  constructor() {
    this.worker.addEventListener('message', ({ data }: MessageEvent<WorkerEvent>) => {
      for (const handler of this.handlers) handler(data);
    });
  }

  send(command: WorkerCommand): void {
    this.worker.postMessage(command);
  }

  onEvent(handler: (event: WorkerEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.worker.terminate();
    this.handlers.clear();
  }
}
