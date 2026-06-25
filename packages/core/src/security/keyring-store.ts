import { Entry } from "@napi-rs/keyring";
import type { SecretStore } from "./secret-store";

/**
 * OS keychain tabanlı sır deposu (Windows Credential Manager / macOS Keychain).
 * Native bağımlılık içerir — yalnızca Electron main process'te kullanılmalıdır
 * (renderer bu alt yola `@nexcode/core/keyring` erişmemelidir).
 */
export class KeyringSecretStore implements SecretStore {
  async set(service: string, account: string, secret: string): Promise<void> {
    new Entry(service, account).setPassword(secret);
  }

  async get(service: string, account: string): Promise<string | null> {
    try {
      return new Entry(service, account).getPassword();
    } catch {
      // Kayıt yoksa keyring hata fırlatır → yok kabul et.
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
