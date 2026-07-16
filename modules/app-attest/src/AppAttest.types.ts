export type AppAttestAvailability = {
  supported: boolean;
  reason: 'supported' | 'simulator' | 'unsupported-device' | 'non-ios';
};

export type AppAttestNativeModule = {
  getAvailability(): Promise<AppAttestAvailability>;
  getKeyId(accountId: string): Promise<string | null>;
  generateKey(accountId: string): Promise<string>;
  removeKeyId(accountId: string): Promise<void>;
  attestKey(keyId: string, clientDataBase64: string): Promise<string>;
  generateAssertion(keyId: string, clientDataBase64: string): Promise<string>;
};
