export type DashboardLiveEvent = { type: 'incident.accepted'; incidentId: string; repository: string; at: string };

export class DashboardLiveEvents {
  private readonly listeners = new Set<(event: DashboardLiveEvent) => void>();

  publish(event: DashboardLiveEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  subscribe(listener: (event: DashboardLiveEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
