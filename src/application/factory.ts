// Singleton factory for route handlers — environment-aware but injectable for tests.
// No live broadcast: ports are fakes unless env wiring is explicitly enabled.

import { fixedClock } from "../features/prism-identity/adapters/clock";
import { InMemoryOwnershipProofStore } from "../features/prism-identity/adapters/memory-ownership-proof-store";
import { viemChallengeCrypto } from "../features/prism-identity/adapters/viem-crypto";
import { LocalErc1271SemanticsChecker } from "../features/prism-identity/testing/fixtures";
import { PrismChallengeService } from "../features/prism-identity/application/challenge-service";
import { InMemoryOperationStore } from "../features/prism-operations/adapters/memory-operation-store";
import { InMemoryRegistry } from "./adapters/in-memory-registry";
import { PrismApplicationService } from "./prism-application";
import { createPrismApiHandlers } from "./handlers";
import { InMemoryPauseService } from "./pause-port";
import { ReceiptService } from "./receipt-service";

export interface AppFactory {
  handlers: ReturnType<typeof createPrismApiHandlers>;
  app: PrismApplicationService;
  registry: InMemoryRegistry;
  operationStore: InMemoryOperationStore;
  pauseService: InMemoryPauseService;
  receiptService: ReceiptService;
  challengeService: PrismChallengeService;
}

let singleton: AppFactory | null = null;

export function getAppFactory(): AppFactory {
  if (singleton) return singleton;
  const clock = fixedClock(Math.floor(Date.now() / 1000));
  const ownershipStore = new InMemoryOwnershipProofStore();
  const checker = new LocalErc1271SemanticsChecker();
  const challengeService = new PrismChallengeService({
    clock,
    crypto: viemChallengeCrypto,
    checker,
    store: ownershipStore,
    policy: { defaultTtlSeconds: 600, defaultDomain: process.env.PRISM_DOMAIN ?? "prism.example", defaultChainId: 84532 },
  });
  const operationStore = new InMemoryOperationStore();
  const registry = new InMemoryRegistry();
  let n = 1;
  const app = new PrismApplicationService({
    challengeService,
    operationStore,
    registry,
    submitPort: registry,
    clock,
    idGenerator: { generateOperationId: () => `op-${n++}-${Date.now()}` },
  });
  const handlers = createPrismApiHandlers(app);
  const pauseService = new InMemoryPauseService(clock);
  const receiptService = new ReceiptService(operationStore);
  singleton = { handlers, app, registry, operationStore, pauseService, receiptService, challengeService };
  return singleton;
}

// For tests: create isolated factory with deterministic clock
export function createIsolatedFactory(start = 1_789_000_000): AppFactory {
  const clock = fixedClock(start);
  const ownershipStore = new InMemoryOwnershipProofStore();
  const checker = new LocalErc1271SemanticsChecker();
  const challengeService = new PrismChallengeService({
    clock,
    crypto: viemChallengeCrypto,
    checker,
    store: ownershipStore,
    policy: { defaultTtlSeconds: 600, defaultDomain: "prism.example", defaultChainId: 84532 },
  });
  const operationStore = new InMemoryOperationStore();
  const registry = new InMemoryRegistry();
  let n = 1;
  const app = new PrismApplicationService({
    challengeService,
    operationStore,
    registry,
    submitPort: registry,
    clock,
    idGenerator: { generateOperationId: () => `op-${n++}-${Date.now()}` },
  });
  const handlers = createPrismApiHandlers(app);
  const pauseService = new InMemoryPauseService(clock);
  const receiptService = new ReceiptService(operationStore);
  return { handlers, app, registry, operationStore, pauseService, receiptService, challengeService };
}

export function resetFactory() {
  singleton = null;
}
