import type { PauseAuthorityResolver } from "../ports/authority";

/** Test-only explicit policy; production/factory defaults must remain unconfigured. */
export const testPauseAuthorityResolver: PauseAuthorityResolver = {
  resolve: async () => ({ authorized: true, actor: "user" }),
};
