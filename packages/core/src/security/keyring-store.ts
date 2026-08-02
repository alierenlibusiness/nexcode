import { Entry } from "@napi-rs/keyring";
import type { SecretStore } from "./secret-store";

/**
 * OS keychain backed secret store (Windows Credential Manager / macOS Keychain).
 * It carries a native dependency, so it must only be used in the Electron main process
 * (the renderer must not reach into the `@nexcode/core/keyring` subpath).
 */
export class KeyringSecretStore implements SecretStore {
  async set(service: string, account: string, secret: string): Promise<void> {
    new Entry(service, account).setPassword(secret);
  }

  async get(service: string, account: string): Promise<string | null> {
    try {
      return new Entry(service, account).getPassword();
    } catch {
      // The keyring throws when there is no record, so treat that as absent.
      return null;
    }
  }

  async delete(service: string, account: string): Promise<boolean> {
    try {
      return new Entry(service, account).deletePassword();
    } catch {
      return false;
    }
  }
}
