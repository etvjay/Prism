type Status = "PLANNED" | "ABSTRACT";

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`status-badge status-badge--${status.toLowerCase()}`}>{status}</span>;
}
