export { default as PrivacyWalletFlow, PrivacyDemoSlot } from "./PrivacyWalletFlow";
export { isPrivacyDemoEnabled, PRIVACY_DEMO_VALUES, privacyDemoHref } from "./demoFlag";
export {
  buildConsentScope,
  consentBindingLine,
  decideConsent,
  type ConsentDecision,
  type ConsentRecord,
  type ConsentScope,
} from "./consent";
export {
  assertFeeFresh,
  canRequestShield,
  createShieldIntent,
  SHIELD_TOKENS,
  twoHashSlots,
  validateShieldAmount,
  type ReceiptSlot,
  type ShieldIntent,
  type ShieldToken,
} from "./shieldIntent";
export {
  createMockStarknetProvider,
  mockReceiptFixture,
  mockTwoHashActivity,
  MOCK_ACCOUNT_ADDRESS,
  MOCK_APPROVAL_HASH,
  MOCK_CONFIRMED_BLOCK,
  MOCK_FEE_LABEL,
  MOCK_MATURITY_TARGET_BLOCK,
  MOCK_POOL_LABEL,
  MOCK_SCENARIOS,
  MOCK_SHIELD_HASH,
  MOCK_WALLET_LABELS,
  type ActivityEntry,
  type ActivityTone,
  type MockReceiptFixture,
  type MockReceiptTone,
  type MockWalletScenario,
} from "./mockPrivacyWallet";
