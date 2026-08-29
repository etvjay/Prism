// In-memory X2 store for Strk20 flows.

import type { Strk20Flow } from "../domain/strk20-state";

export class MemoryStrk20Store {
  private readonly map = new Map<string, Strk20Flow>();

  put(flow: Strk20Flow): void {
    this.map.set(flow.id, flow);
  }

  get(id: string): Strk20Flow | null {
    return this.map.get(id) ?? null;
  }

  list(): Strk20Flow[] {
    return [...this.map.values()];
  }

  clear(): void {
    this.map.clear();
  }
}
