import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDiskStorage } from '../../../src/infrastructure/storage/local-disk.storage.js';

function makeStorage(): { storage: LocalDiskStorage; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'orderup-storage-unit-'));
  const config = {
    get: (key: string) => (key === 'STORAGE_LOCAL_DIR' ? dir : undefined),
  };
  return { storage: new LocalDiskStorage(config as never), dir };
}

describe('LocalDiskStorage', () => {
  it('stores, reads, checks and deletes files', async () => {
    const { storage, dir } = makeStorage();
    try {
      const key = 'tenant/x/messages/y/file.bin';
      const data = Buffer.from('hello');

      expect(await storage.exists(key)).toBe(false);
      await storage.put(key, data);
      expect(await storage.exists(key)).toBe(true);
      expect((await storage.get(key)).toString()).toBe('hello');

      await storage.delete(key);
      expect(await storage.exists(key)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects keys that escape the base directory', async () => {
    const { storage, dir } = makeStorage();
    try {
      await expect(storage.put('../escape.bin', Buffer.from('x'))).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
