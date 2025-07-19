import * as fs from 'node:fs';
import * as os from 'node:os';

interface Option {
  windowsHide: boolean;
  env?: any;
}

export class Desktop {
  public static isWindows(): boolean {
    return os.platform() === 'win32';
  }

  public static getHomeDirectory(): string {
    const home = process.env.WAKATIME_HOME;
    if (home?.trim() && fs.existsSync(home.trim())) return home.trim();
    return (
      process.env[Desktop.isWindows() ? 'USERPROFILE' : 'HOME'] || process.cwd()
    );
  }

  public static buildOptions(): any {
    const options: Option = {
      windowsHide: true,
    };
    if (
      !Desktop.isWindows() &&
      !process.env.WAKATIME_HOME &&
      !process.env.HOME
    ) {
      options.env = {
        ...process.env,
        WAKATIME_HOME: Desktop.getHomeDirectory(),
      };
    }
    return options;
  }
}
