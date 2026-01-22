import fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { whichSync } from './which';

vi.mock('node:fs');

describe('whichSync', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it('should return null if PATH is not set', () => {
    delete process.env.PATH;
    const result = whichSync('my-cmd');
    expect(result).toBeNull();
  });

  it('should return null if command is not found in PATH', () => {
    process.env.PATH = `/usr/bin${path.delimiter}/bin`;
    vi.mocked(fs.accessSync).mockImplementation(() => {
      throw new Error('Not found');
    });

    const result = whichSync('non-existent');
    expect(result).toBeNull();
  });

  it('should return the path if command is found', () => {
    const cmd = 'test-cmd';
    const dir = '/usr/local/bin';
    process.env.PATH = dir;

    vi.mocked(fs.accessSync).mockImplementation((p) => {
      if (p === path.join(dir, cmd)) {
        return;
      }
      throw new Error('Not found');
    });

    const result = whichSync(cmd);
    expect(result).toBe(path.join(dir, cmd));
  });

  it('should handle quoted paths in PATH', () => {
    const cmd = 'test-cmd';
    const dir = '/usr/local/bin';
    process.env.PATH = `"${dir}"`;

    vi.mocked(fs.accessSync).mockImplementation((p) => {
      if (p === path.join(dir, cmd)) {
        return;
      }
      throw new Error('Not found');
    });

    const result = whichSync(cmd);
    expect(result).toBe(path.join(dir, cmd));
  });

  it('should find the command in the second directory of PATH', () => {
    const cmd = 'test-cmd';
    const dir1 = '/usr/bin';
    const dir2 = '/usr/local/bin';
    process.env.PATH = dir1 + path.delimiter + dir2;

    vi.mocked(fs.accessSync).mockImplementation((p) => {
      if (p === path.join(dir2, cmd)) {
        return;
      }
      throw new Error('Not found');
    });

    const result = whichSync(cmd);
    expect(result).toBe(path.join(dir2, cmd));
  });
});
