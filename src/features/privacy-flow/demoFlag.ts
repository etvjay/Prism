/**
 * Demo-flag gate for the Prism privacy wallet flow.
 *
 * The flow renders only when the URL carries `?demo=privacy`
 * (`privacy-style` and `session` are accepted aliases). Default landing
 * and workspace renders are unchanged when the flag is absent.
 */

export const PRIVACY_DEMO_VALUES = ["privacy", "privacy-style", "session"] as const;

export function isPrivacyDemoEnabled(search: string | null | undefined): boolean {
  if (!search) return false;
  const query = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  const value = params.get("demo");
  if (value === null) return false;
  return (PRIVACY_DEMO_VALUES as readonly string[]).includes(value.trim().toLowerCase());
}

export function privacyDemoHref(value: (typeof PRIVACY_DEMO_VALUES)[number] = "privacy"): string {
  return `?demo=${value}`;
}
