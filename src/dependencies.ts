import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import extract from 'extract-zip';
import { buildOptions, getHomeDirectory, isWindows } from './desktop';
import type { Logger } from './logger';
import type { Options } from './options';
import { whichSync } from './which';

const execFile = promisify(child_process.execFile);

export class Dependencies {
  private options: Options;
  private logger: Logger;
  private resourcesLocation?: string = undefined;
  private cliLocation?: string = undefined;
  private cliLocationGlobal?: string = undefined;
  private cliInstalled = false;
  private githubDownloadPrefix =
    'https://github.com/wakatime/wakatime-cli/releases/download';
  private githubReleasesStableUrl =
    'https://api.github.com/repos/wakatime/wakatime-cli/releases/latest';
  private githubReleasesAlphaUrl =
    'https://api.github.com/repos/wakatime/wakatime-cli/releases?per_page=1';
  private latestCliVersion = '';

  constructor(options: Options, logger: Logger) {
    this.options = options;
    this.logger = logger;
  }

  private getResourcesLocation() {
    if (this.resourcesLocation) return this.resourcesLocation;

    const folder = path.join(getHomeDirectory(), '.wakatime');
    try {
      fs.mkdirSync(folder, { recursive: true });
      this.resourcesLocation = folder;
    } catch (_e) {
      this.resourcesLocation = './.wakatime';
    }
    return this.resourcesLocation;
  }

  public getCliLocation(): string {
    if (this.cliLocation) return this.cliLocation;

    this.cliLocation = this.getCliLocationGlobal();
    if (this.cliLocation) return this.cliLocation;

    const ext = isWindows() ? '.exe' : '';
    let osname = os.platform() as string;
    if (osname === 'win32') osname = 'windows';
    const arch = this.architecture();
    this.cliLocation = path.join(
      this.getResourcesLocation(),
      `wakatime-cli-${osname}-${arch}${ext}`,
    );

    return this.cliLocation;
  }

  public getCliLocationGlobal(): string | undefined {
    if (this.cliLocationGlobal) return this.cliLocationGlobal;

    const binaryName = `wakatime-cli${isWindows() ? '.exe' : ''}`;
    const path = whichSync(binaryName);
    if (path) {
      this.cliLocationGlobal = path;
      this.logger.debug(`Using global wakatime-cli location: ${path}`);
    }

    return this.cliLocationGlobal;
  }

  public isCliInstalled(): boolean {
    if (this.cliInstalled) return true;
    this.cliInstalled = fs.existsSync(this.getCliLocation());
    return this.cliInstalled;
  }

  public async checkAndInstallCli(): Promise<boolean> {
    if (!this.isCliInstalled()) {
      if (!(await this.installCli())) {
        this.logger.error('Failed to install wakatime-cli.');
        return false;
      }
    } else {
      const isLatest = await this.isCliLatest();
      if (!isLatest) {
        if (!(await this.installCli())) {
          this.logger.error('Failed to update wakatime-cli.');
          return false;
        }
      }
    }
    return true;
  }

  private async isCliLatest(): Promise<boolean> {
    if (this.getCliLocationGlobal()) {
      return true;
    }

    const args = ['--version'];
    const options = buildOptions();
    try {
      const { stdout, stderr } = await execFile(
        this.getCliLocation(),
        args,
        options,
      );
      const currentVersion =
        stdout.toString().trim() + stderr.toString().trim();
      this.logger.debug(`Current wakatime-cli version is ${currentVersion}`);

      this.logger.debug('Checking for updates to wakatime-cli...');
      const latestVersion = await this.getLatestCliVersion();
      if (currentVersion === latestVersion) {
        this.logger.debug('wakatime-cli is up to date');
        return true;
      } else if (latestVersion) {
        this.logger.debug(`Found an updated wakatime-cli ${latestVersion}`);
        return false;
      } else {
        this.logger.debug('Unable to find latest wakatime-cli version');
        return false;
      }
    } catch (_e) {
      return false;
    }
  }

  private async getLatestCliVersion(): Promise<string> {
    if (this.latestCliVersion) {
      return this.latestCliVersion;
    }

    const [modified, version, alpha] = await Promise.all([
      this.options.getSettingAsync('internal', 'cli_version_last_modified'),
      this.options.getSettingAsync('internal', 'cli_version'),
      this.options.getSettingAsync('settings', 'alpha'),
    ]);

    const options: RequestInit = {
      method: 'GET',
      headers: {
        'User-Agent': 'github.com/wakatime/vscode-wakatime',
        Accept: 'application/json',
        'If-Modified-Since':
          modified?.value && version?.value ? modified.value : '',
      },
    };

    try {
      const response = await fetch(
        alpha?.value === 'true'
          ? this.githubReleasesAlphaUrl
          : this.githubReleasesStableUrl,
        options,
      );

      if (response.ok || response.status === 304) {
        this.logger.debug(`GitHub API Response ${response.status}`);
        if (response.status === 304) {
          this.latestCliVersion = version?.value || '';
          return this.latestCliVersion;
        }

        const json = await response.json();
        this.latestCliVersion =
          alpha?.value === 'true' ? json[0].tag_name : json.tag_name;

        this.logger.debug(
          `Latest wakatime-cli version from GitHub: ${this.latestCliVersion}`,
        );

        const lastModified = response.headers.get('last-modified');
        if (lastModified && this.latestCliVersion) {
          this.options.setSettings(
            'internal',
            [
              {
                key: 'cli_version',
                value: this.latestCliVersion,
              },
              {
                key: 'cli_version_last_modified',
                value: lastModified,
              },
            ],
            true,
          );
        }
        return this.latestCliVersion;
      } else {
        this.logger.warn(`GitHub API Response ${response.status}`);
      }
    } catch (e) {
      this.logger.warnException(e);
    }
    return '';
  }

  private async installCli(): Promise<boolean> {
    const version = await this.getLatestCliVersion();
    if (version === '') {
      this.logger.warn('Unable to find latest wakatime-cli version');
      return false;
    }
    const url = this.cliDownloadUrl(version);
    const zipFile = path.join(
      this.getResourcesLocation(),
      `wakatime-cli${this.randStr()}.zip`,
    );
    this.logger.debug(`Downloading wakatime-cli ${version} from ${url}...`);
    if (!(await this.downloadFile(url, zipFile))) {
      this.logger.error('Failed to download wakatime-cli from github.');
      return false;
    }
    if (!(await this.extractCli(zipFile))) {
      this.logger.error(
        `Failed to extract wakatime-cli (${zipFile} -> ${this.getResourcesLocation()}).`,
      );
      return false;
    }
    return true;
  }

  private async extractCli(zipFile: string): Promise<boolean> {
    this.logger.debug(
      `Extracting wakatime-cli into "${this.getResourcesLocation()}"...`,
    );
    if (!await this.removeCliIfExists()) {
      this.logger.error('Failed to remove existing wakatime-cli.');
      return false;
    }
    if (!(await this.unzip(zipFile, this.getResourcesLocation()))) {
      this.logger.error('Failed to extract wakatime-cli.');
    }

    if (!isWindows()) {
      const cli = this.getCliLocation();
      try {
        this.logger.debug('Chmod 755 wakatime-cli...');
        await fsp.chmod(cli, 0o755);
      } catch (e) {
        this.logger.warnException(e);
      }
      const link = path.join(this.getResourcesLocation(), `wakatime-cli`);
      if (!fs.lstatSync(link).isSymbolicLink()) {
        try {
          this.logger.debug(`Create symlink from wakatime-cli to ${cli}`);
          await fsp.symlink(cli, link);
        } catch (e) {
          this.logger.warnException(e);
          try {
            await fsp.copyFile(cli, link);
            await fsp.chmod(link, 0o755);
          } catch (e2) {
            this.logger.warnException(e2);
            return false;
          }
        }
      }
    }
    this.logger.debug('Finished extracting wakatime-cli.');
    return true;
  }

  private async removeCliIfExists(): Promise<boolean> {
    if (fs.existsSync(this.getCliLocation())) {
      try {
        await fsp.unlink(this.getCliLocation());
        return true;
      } catch (e) {
        this.logger.warn(
          `Failed to remove existing wakatime-cli at ${this.getCliLocation()}`,
        );
        this.logger.warnException(e);
        return false;
      }
    }
    return true;
  }

  private async downloadFile(
    url: string,
    outputFile: string,
  ): Promise<boolean> {
    const download = async (
      urlToGet: string,
      redirectsLeft: number,
    ): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        const req = https.get(urlToGet, async (res) => {
          const status = res.statusCode || 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            if (redirectsLeft > 0) {
              res.resume();
              // small delay
              await new Promise((r) => setTimeout(r, 1000));
              return download(res.headers.location, redirectsLeft - 1)
                .then(resolve)
                .catch(reject);
            } else {
              return reject(new Error('Too many redirects'));
            }
          }
          if (status !== 200) {
            res.resume();
            return reject(new Error(`Request failed. Status: ${status}`));
          }
          const fileStream = fs.createWriteStream(outputFile);
          res.pipe(fileStream);
          fileStream.on('finish', () => fileStream.close(() => resolve()));
          fileStream.on('error', reject);
        });
        req.on('error', reject);
      });
    };

    const maxRedirects = 5;
    try {
      await download(url, maxRedirects);
      return true;
    } catch (e) {
      this.logger.warnException(e);
      return false;
    }
  }

  private async unzip(file: string, outputDir: string): Promise<boolean> {
    if (fs.existsSync(file)) {
      try {
        await extract(file, { dir: outputDir });
        return true;
      } catch (e) {
        this.logger.errorException(e);
        return false;
      } finally {
        try {
          await fsp.unlink(file);
        } catch (_e2) {
          // ignore
        }
      }
    }
    return false;
  }

  private architecture(): string {
    const arch = os.arch();
    if (arch.indexOf('32') > -1) return '386';
    if (arch.indexOf('x64') > -1) return 'amd64';
    return arch;
  }

  private cliDownloadUrl(version: string): string {
    let osname = os.platform() as string;
    if (osname === 'win32') osname = 'windows';
    const arch = this.architecture();

    const validCombinations = [
      'darwin-amd64',
      'darwin-arm64',
      'freebsd-386',
      'freebsd-amd64',
      'freebsd-arm',
      'linux-386',
      'linux-amd64',
      'linux-arm',
      'linux-arm64',
      'netbsd-386',
      'netbsd-amd64',
      'netbsd-arm',
      'openbsd-386',
      'openbsd-amd64',
      'openbsd-arm',
      'openbsd-arm64',
      'windows-386',
      'windows-amd64',
      'windows-arm64',
    ];
    if (!validCombinations.includes(`${osname}-${arch}`))
      this.reportMissingPlatformSupport(osname, arch);

    return `${this.githubDownloadPrefix}/${version}/wakatime-cli-${osname}-${arch}.zip`;
  }

  private reportMissingPlatformSupport(
    osname: string,
    architecture: string,
  ): void {
    const url = `https://api.wakatime.com/api/v1/cli-missing?osname=${osname}&architecture=${architecture}&plugin=obsidian`;
    const options: RequestInit = {
      method: 'GET',
    };
    fetch(url, options).catch();
  }

  private randStr(): string {
    return (Math.random() + 1).toString(36).substring(7);
  }
}
