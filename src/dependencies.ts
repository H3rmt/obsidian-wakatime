import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import AdmZip from 'adm-zip';
import which from 'which';
import { buildOptions, getHomeDirectory, isWindows } from './desktop';
import type { Logger } from './logger';
import type { OptionSetting, Options } from './options';

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
    const path = which.sync(binaryName, { nothrow: true });
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

  public checkAndInstallCli(callback: () => void): void {
    if (!this.isCliInstalled()) {
      this.installCli(callback);
    } else {
      this.isCliLatest((isLatest) => {
        if (!isLatest) {
          this.installCli(callback);
        } else {
          callback();
        }
      });
    }
  }

  private isCliLatest(callback: (arg0: boolean) => void): void {
    if (this.getCliLocationGlobal()) {
      callback(true);
      return;
    }

    const args = ['--version'];
    const options = buildOptions();
    try {
      child_process.execFile(
        this.getCliLocation(),
        args,
        options,
        (error, _stdout, stderr) => {
          if (!(error != null)) {
            const currentVersion =
              _stdout.toString().trim() + stderr.toString().trim();
            this.logger.debug(
              `Current wakatime-cli version is ${currentVersion}`,
            );

            this.logger.debug('Checking for updates to wakatime-cli...');
            this.getLatestCliVersion((latestVersion) => {
              if (currentVersion === latestVersion) {
                this.logger.debug('wakatime-cli is up to date');
                callback(true);
              } else if (latestVersion) {
                this.logger.debug(
                  `Found an updated wakatime-cli ${latestVersion}`,
                );
                callback(false);
              } else {
                this.logger.debug('Unable to find latest wakatime-cli version');
                callback(false);
              }
            });
          } else {
            callback(false);
          }
        },
      );
    } catch (_e) {
      callback(false);
    }
  }

  private getLatestCliVersion(callback: (arg0: string) => void): void {
    if (this.latestCliVersion) {
      callback(this.latestCliVersion);
      return;
    }
    this.options.getSetting(
      'internal',
      'cli_version_last_modified',
      true,
      (modified: OptionSetting) => {
        this.options.getSetting(
          'internal',
          'cli_version',
          true,
          (version: OptionSetting) => {
            this.options.getSetting(
              'settings',
              'alpha',
              false,
              (alpha: OptionSetting) => {
                const options: RequestInit = {
                  method: 'GET',
                  headers: {
                    'User-Agent': 'github.com/wakatime/vscode-wakatime',
                    Accept: 'application/json',
                    'If-Modified-Since':
                      modified.value && version.value ? modified.value : '',
                  },
                };
                try {
                  fetch(
                    alpha.value === 'true'
                      ? this.githubReleasesAlphaUrl
                      : this.githubReleasesStableUrl,
                    options,
                  ).then((response) => {
                    if (response.ok || response.status === 304) {
                      this.logger.debug(
                        `GitHub API Response ${response.status}`,
                      );
                      if (response.status === 304) {
                        this.latestCliVersion = version.value;
                        callback(this.latestCliVersion);
                        return;
                      }

                      response.json().then((json) => {
                        this.latestCliVersion =
                          alpha.value === 'true'
                            ? json[0].tag_name
                            : json.tag_name;

                        this.logger.debug(
                          `Latest wakatime-cli version from GitHub: ${this.latestCliVersion}`,
                        );

                        const lastModified =
                          response.headers.get('last-modified');
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
                        callback(this.latestCliVersion);
                      });
                    } else {
                      this.logger.warn(
                        `GitHub API Response ${response.status}`,
                      );
                      callback('');
                    }
                  });
                } catch (e) {
                  this.logger.warnException(e);
                  callback('');
                }
              },
            );
          },
        );
      },
    );
  }

  private installCli(callback: () => void): void {
    this.getLatestCliVersion((version) => {
      if (!version) {
        callback();
        return;
      }
      this.logger.debug(`Downloading wakatime-cli ${version}...`);
      const url = this.cliDownloadUrl(version);
      const zipFile = path.join(
        this.getResourcesLocation(),
        `wakatime-cli${this.randStr()}.zip`,
      );
      this.downloadFile(
        url,
        zipFile,
        () => {
          this.extractCli(zipFile, callback);
        },
        callback,
      );
    });
  }

  private isSymlink(file: string): boolean {
    try {
      return fs.lstatSync(file).isSymbolicLink();
      // eslint-disable-next-line no-empty
    } catch (_) {}
    return false;
  }

  private extractCli(zipFile: string, callback: () => void): void {
    this.logger.debug(
      `Extracting wakatime-cli into "${this.getResourcesLocation()}"...`,
    );
    this.removeCli(() => {
      this.unzip(zipFile, this.getResourcesLocation(), () => {
        if (!isWindows()) {
          const cli = this.getCliLocation();
          try {
            this.logger.debug('Chmod 755 wakatime-cli...');
            fs.chmodSync(cli, 0o755);
          } catch (e) {
            this.logger.warnException(e);
          }
          const ext = isWindows() ? '.exe' : '';
          const link = path.join(
            this.getResourcesLocation(),
            `wakatime-cli${ext}`,
          );
          if (!this.isSymlink(link)) {
            try {
              this.logger.debug(`Create symlink from wakatime-cli to ${cli}`);
              fs.symlinkSync(cli, link);
            } catch (e) {
              this.logger.warnException(e);
              try {
                fs.copyFileSync(cli, link);
                fs.chmodSync(link, 0o755);
              } catch (e2) {
                this.logger.warnException(e2);
              }
            }
          }
        }
        callback();
      });
      this.logger.debug('Finished extracting wakatime-cli.');
    });
  }

  private removeCli(callback: () => void): void {
    if (fs.existsSync(this.getCliLocation())) {
      fs.unlink(this.getCliLocation(), () => {
        callback();
      });
    } else {
      callback();
    }
  }

  private downloadFile(
    url: string,
    outputFile: string,
    callback: () => void,
    error: () => void,
  ): void {
    const options: RequestInit = {
      method: 'GET',
    };
    fetch(url, options)
      .then((response) => {
        if (!response.ok) {
          this.logger.warn(`Failed to download ${url}`);
          this.logger.warn(`Status: ${response.status}`);
          error();
          return;
        }
        response
          .arrayBuffer()
          .then((arrayBuffer) => {
            try {
              fs.writeFileSync(outputFile, Buffer.from(arrayBuffer));
              callback();
            } catch (err) {
              this.logger.warnException(err);
              error();
            }
          })
          .catch((err) => {
            this.logger.warnException(err);
            error();
          });
      })
      .catch((e) => {
        this.logger.warnException(e);
        callback();
      });
  }

  private unzip(file: string, outputDir: string, callback: () => void): void {
    if (fs.existsSync(file)) {
      try {
        const zip = new AdmZip(file);
        zip.extractAllTo(outputDir, true);
      } catch (e) {
        this.logger.errorException(e);
      } finally {
        try {
          fs.unlink(file, () => {
            callback();
          });
        } catch (_e2) {
          callback();
        }
      }
    }
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
