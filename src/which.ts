import fs, { constants as fsConstants } from 'node:fs';
import * as path from 'node:path';
import { isWindows } from './desktop';

const isexeSync = (filePath: string): boolean => {
  try {
    if (isWindows()) {
      fs.accessSync(filePath, fsConstants.F_OK);
      return true;
    }
    fs.accessSync(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const whichSync = (cmd: string): string | null => {
  const pathEnv = process.env.PATH?.split(path.delimiter) || [];

  for (const pathEnvPart of pathEnv) {
    const pathPart = /^".*"$/.test(pathEnvPart)
      ? pathEnvPart.slice(1, -1)
      : pathEnvPart;
    const p = path.join(pathPart, cmd);
    if (isexeSync(p)) {
      return p;
    }
  }

  return null;
};

export { whichSync };
