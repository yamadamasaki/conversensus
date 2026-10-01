import { describe, expect, test } from 'bun:test';
import { BunSqliteDriver, IN_MEMORY } from './bunSqliteDriver';
import { SQL_DRIVER_CONTRACT } from './sqlDriverContract';

describe('BunSqliteDriver は SqlDriver の契約を満たす', () => {
  for (const { name, check } of SQL_DRIVER_CONTRACT) {
    test(name, () => {
      const driver = new BunSqliteDriver(IN_MEMORY);
      expect(() => check(driver)).not.toThrow();
      driver.close();
    });
  }
});
