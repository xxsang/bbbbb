export type ApnsEnvironment = "sandbox" | "production";

export interface RegisteredDevice {
  readonly token: string;
  readonly environment: ApnsEnvironment;
  readonly updatedAt: number;
}

export interface DeviceStore {
  replace(inboxId: string, device: RegisteredDevice): Promise<void>;
  get(inboxId: string): Promise<RegisteredDevice | null>;
  remove(inboxId: string): Promise<void>;
  disable(inboxId: string, token: string): Promise<void>;
}

export class MemoryV2DeviceStore implements DeviceStore {
  readonly #devices = new Map<string, RegisteredDevice>();
  async replace(inboxId: string, device: RegisteredDevice): Promise<void> { this.#devices.set(inboxId, { ...device }); }
  async get(inboxId: string): Promise<RegisteredDevice | null> {
    const device = this.#devices.get(inboxId);
    return device ? { ...device } : null;
  }
  async remove(inboxId: string): Promise<void> { this.#devices.delete(inboxId); }
  async disable(inboxId: string, token: string): Promise<void> {
    if (this.#devices.get(inboxId)?.token === token) this.#devices.delete(inboxId);
  }
}

interface DeviceRow {
  readonly device_token: string;
  readonly environment: ApnsEnvironment;
  readonly updated_at: number;
}

export class D1V2DeviceStore implements DeviceStore {
  constructor(private readonly database: D1Database) {}
  async replace(inboxId: string, device: RegisteredDevice): Promise<void> {
    await this.database.prepare(`INSERT INTO v2_devices (inbox_id, device_token, environment, updated_at, enabled)
      VALUES (?, ?, ?, ?, 1) ON CONFLICT(inbox_id) DO UPDATE SET device_token = excluded.device_token,
      environment = excluded.environment, updated_at = excluded.updated_at, enabled = 1`).bind(inboxId, device.token, device.environment, device.updatedAt).run();
  }
  async get(inboxId: string): Promise<RegisteredDevice | null> {
    const row = await this.database.prepare("SELECT device_token, environment, updated_at FROM v2_devices WHERE inbox_id = ? AND enabled = 1 LIMIT 1").bind(inboxId).first<DeviceRow>();
    return row ? { token: row.device_token, environment: row.environment, updatedAt: row.updated_at } : null;
  }
  async remove(inboxId: string): Promise<void> { await this.database.prepare("DELETE FROM v2_devices WHERE inbox_id = ?").bind(inboxId).run(); }
  async disable(inboxId: string, token: string): Promise<void> { await this.database.prepare("UPDATE v2_devices SET enabled = 0 WHERE inbox_id = ? AND device_token = ?").bind(inboxId, token).run(); }
}
