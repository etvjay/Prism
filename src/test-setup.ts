import { beforeEach } from "vitest";

// Route tests intentionally use synthetic sessions; production/rehearsal never do.
beforeEach(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = "test";
  process.env.PRISM_RUNTIME_MODE = "test";
  process.env.PRISM_TEST_ONLY_ALLOW_SESSION_FIXTURES = "1";
});
