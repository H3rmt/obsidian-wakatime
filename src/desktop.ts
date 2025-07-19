import * as fs from 'node:fs';
import * as os from 'node:os';

interface Option {
  windowsHide: boolean;
  env?: Record<string, string>;
}

export function isWindows(): boolean {
  return os.platform() === 'win32';
}

export function getHomeDirectory(): string {
  const home = process.env.WAKATIME_HOME;
  if (home?.trim() && fs.existsSync(home.trim())) return home.trim();
  return process.env[isWindows() ? 'USERPROFILE' : 'HOME'] || process.cwd();
}

export function buildOptions(): Option {
  const options: Option = {
    windowsHide: true,
  };
  if (!isWindows() && !process.env.WAKATIME_HOME && !process.env.HOME) {
    options.env = {
      ...process.env,
      WAKATIME_HOME: getHomeDirectory(),
    };
  }
  return options;
}
