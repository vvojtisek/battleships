export interface Transport<TCommand, TEvent> {
  send(command: TCommand): void;
  onEvent(handler: (event: TEvent) => void): () => void;
  readonly status: 'connecting' | 'open' | 'resuming' | 'closed';
  close(): void;
}
