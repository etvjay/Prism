/**
 * Demo-flag gate for the Prism read-only live-state surface.
 *
 * Renders only when the URL carries `?demo=livestate`
 * (`live-state` and `live` are accepted aliases). Default landing and
 * workspace renders are unchanged when the flag is absent.
 */

export const LIVESTATE_DEMO_VALUES = ["livestate", "live-state", "live"] as const;

export function isLiveStateDemoEnabled(search: string | null | undefined): boolean {
  if (!search) return false;
  const query = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  const value = params.get("demo");
  if (value === null) return false;
  return (LIVESTATE_DEMO_VALUES as readonly string[]).includes(value.trim().toLowerCase());
}

export function liveStateDemoHref(value: (typeof LIVESTATE_DEMO_VALUES)[number] = "livestate"): string {
  return `?demo=${value}`;
}

/** Return a validated, explicitly selected Prism ID from the browser URL. */
export function selectedPrismIdFromSearch(search: string | null | undefined): string | null {
  if (!search) return null;
  const query = search.startsWith("?") ? search.slice(1) : search;
  const raw = new URLSearchParams(query).get("prismId")?.trim() ?? "";
  if (/^[1-9][0-9]*$/.test(raw)) return raw;
  if (/^prism:[1-9][0-9]*$/.test(raw)) return raw.slice("prism:".length);
  return null;
}
