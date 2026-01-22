import * as child_process from 'node:child_process';
import {
  type App,
  apiVersion,
  type EditorPosition,
  type FileSystemAdapter,
  FileView,
  MarkdownView,
  Modal,
  Plugin,
  Setting,
  type TextComponent,
} from 'obsidian';
import { LogLevel } from './constants';
import { Dependencies } from './dependencies';
import { buildOptions, isWindows } from './desktop';
import { Logger } from './logger';
import { Options } from './options';
import { apiKeyInvalid, formatArguments, formatDate, quote } from './utils';

// noinspection JSUnusedGlobalSymbols
export default class WakaTime extends Plugin {
  options: Options;
  statusBar: HTMLElement;
  showStatusBar: boolean;
  showCodingActivity: boolean;
  logger: Logger;
  dependencies: Dependencies;
  disabled: boolean;
  lastFetchToday = 0;
  fetchTodayInterval = 60000;
  lastFile: string;
  lastHeartbeat = 0;

  async onload() {
    this.logger = new Logger(LogLevel.INFO);
    this.options = new Options(this.logger);

    this.addCommand({
      id: 'wakatime-api-key',
      name: 'WakaTime API Key',
      callback: () => {
        this.promptForApiKey();
      },
    });

    const debug = await this.options.getSettingAsync('settings', 'debug');
    this.logger.setLevel(
      debug?.value === 'true' ? LogLevel.DEBUG : LogLevel.INFO,
    );
    this.dependencies = new Dependencies(this.options, this.logger);

    const disabled = await this.options.getSettingAsync('settings', 'disabled');
    this.disabled = disabled?.value === 'true';
    if (this.disabled) {
      return;
    }

    await this.initializeDependencies();
  }

  onunload() {}

  public async initializeDependencies(): Promise<void> {
    this.logger.debug(`Initializing WakaTime v${this.manifest.version}`);

    this.statusBar = this.addStatusBarItem();

    const [statusBarEnabled, showCodingActivity] = await Promise.all([
      this.options.getSettingAsync('settings', 'status_bar_enabled'),
      this.options.getSettingAsync('settings', 'status_bar_coding_activity'),
    ]);

    this.showStatusBar = statusBarEnabled?.value !== 'false';
    this.updateStatusBarText('WakaTime Initializing...');

    await this.checkApiKey();

    this.setupEventListeners();

    this.showCodingActivity = showCodingActivity?.value !== 'false';

    await this.dependencies.checkAndInstallCli();
    this.logger.debug('WakaTime initialized');
    this.updateStatusBarText();
    this.updateStatusBarTooltip('WakaTime: Initialized');
    await this.getCodingActivity();
  }

  private async checkApiKey(): Promise<void> {
    const hasApiKey = await this.options.hasApiKeyAsync();
    if (!hasApiKey) this.promptForApiKey();
  }

  private setupEventListeners(): void {
    this.registerDomEvent(document, 'click', () => {
      this.onEvent();
    });
    this.registerDomEvent(document, 'keydown', () => {
      this.onEvent();
    });
    this.registerDomEvent(document, 'wheel', () => {
      this.onEvent();
    });
  }

  private onEvent() {
    const view = this.app.workspace.getActiveViewOfType(FileView);
    if (!view) return;

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) return;

    const file = `${(this.app.vault.adapter as FileSystemAdapter).getBasePath()}/${activeFile.path}`;
    const time: number = Date.now();

    if (this.enoughTimePassed(time) || this.lastFile !== file) {
      let cursor: EditorPosition | null = null;
      if (view instanceof MarkdownView) {
        cursor = view.editor.getCursor();
      }

      this.sendHeartbeat(file, time, cursor?.line, cursor?.ch, false);
      this.lastFile = file;
      this.lastHeartbeat = time;
    }
  }

  private enoughTimePassed(time: number): boolean {
    // send every 60s max
    return this.lastHeartbeat + 60 * 1000 < time;
  }

  private updateStatusBarText(text?: string): void {
    if (!this.statusBar) return;
    if (!text) {
      this.statusBar.setText('🕒');
    } else {
      this.statusBar.setText(`🕒 ${text}`);
    }
  }

  private updateStatusBarTooltip(tooltipText: string): void {
    if (!this.statusBar) return;
    this.statusBar.setAttr('title', tooltipText);
  }

  public promptForApiKey(): void {
    new ApiKeyModal(this.app, this.options).open();
  }

  private async sendHeartbeat(
    file: string,
    time: number,
    lineno: number | undefined,
    cursorpos: number | undefined,
    isWrite: boolean,
  ): Promise<void> {
    const apiKey = await this.options.getApiKeyAsync();
    if (!apiKey) return;
    this._sendHeartbeat(file, time, lineno, cursorpos, isWrite);
  }

  private _sendHeartbeat(
    file: string,
    time: number,
    lineno: number | undefined,
    cursorpos: number | undefined,
    isWrite: boolean,
  ): void {
    if (!this.dependencies.isCliInstalled()) return;

    const args: string[] = [];

    args.push('--category', 'notes');
    args.push('--entity', quote(file));
    args.push('--project', String(this.app.vault.getName()));

    // Use the exact time when the event occurred, not "now".
    args.push('--time', (time / 1000).toFixed(6));

    const user_agent = `obsidian/${apiVersion} obsidian-wakatime/${this.manifest.version}`;
    args.push('--plugin', quote(user_agent));

    if (lineno !== undefined) args.push('--lineno', String(lineno + 1));
    if (cursorpos !== undefined)
      args.push('--cursorpos', String(cursorpos + 1));

    if (file.endsWith('.pdf')) args.push('--language', quote('Pdf'));

    if (isWrite) args.push('--write');

    if (isWindows()) {
      args.push(
        '--config',
        quote(this.options.getConfigFile(false)),
        '--log-file',
        quote(this.options.getLogFile()),
      );
    }

    const binary = this.dependencies.getCliLocation();
    this.logger.debug(`Sending heartbeat: ${formatArguments(binary, args)}`);
    const options = buildOptions();
    const proc = child_process.execFile(
      binary,
      args,
      options,
      (error, stdout, stderr) => {
        if (error != null) {
          if (stderr && stderr.toString() !== '')
            this.logger.error(stderr.toString());
          if (stdout && stdout.toString() !== '')
            this.logger.error(stdout.toString());
          this.logger.error(error.toString());
        }
      },
    );
    proc.on('close', async (code, _signal) => {
      if (code === 0) {
        if (this.showStatusBar) await this.getCodingActivity();
        this.logger.debug(`last heartbeat sent ${formatDate(new Date())}`);
      } else if (code === 102 || code === 112) {
        if (this.showStatusBar) {
          if (!this.showCodingActivity) this.updateStatusBarText();
          this.updateStatusBarTooltip(
            'WakaTime: working offline... coding activity will sync next time we are online',
          );
        }
        this.logger.warn(
          `Working offline (${code}); Check your ${this.options.getLogFile()} file for more details`,
        );
      } else if (code === 103) {
        const error_msg = `Config parsing error (103); Check your ${this.options.getLogFile()} file for more details`;
        if (this.showStatusBar) {
          this.updateStatusBarText('WakaTime Error');
          this.updateStatusBarTooltip(`WakaTime: ${error_msg}`);
        }
        this.logger.error(error_msg);
      } else if (code === 104) {
        const error_msg =
          'Invalid Api Key (104); Make sure your Api Key is correct!';
        if (this.showStatusBar) {
          this.updateStatusBarText('WakaTime Error');
          this.updateStatusBarTooltip(`WakaTime: ${error_msg}`);
        }
        this.logger.error(error_msg);
      } else {
        const error_msg = `Unknown Error (${code}); Check your ${this.options.getLogFile()} file for more details`;
        if (this.showStatusBar) {
          this.updateStatusBarText('WakaTime Error');
          this.updateStatusBarTooltip(`WakaTime: ${error_msg}`);
        }
        this.logger.error(error_msg);
      }
    });
  }

  private async getCodingActivity(): Promise<void> {
    if (!this.showStatusBar) {
      return;
    }

    // prevent updating if we haven't coded since last checked
    if (this.lastFetchToday > 0 && this.lastFetchToday > this.lastHeartbeat)
      return;

    const cutoff = Date.now() - this.fetchTodayInterval;
    if (this.lastFetchToday > cutoff) return;

    this.lastFetchToday = Date.now();

    const apiKey = await this.options.getApiKeyAsync();
    if (!apiKey) return;
    this._getCodingActivity();
  }

  private _getCodingActivity() {
    if (!this.dependencies.isCliInstalled()) return;

    const user_agent = `obsidian/${apiVersion} obsidian-wakatime/${this.manifest.version}`;
    const args = ['--today', '--plugin', quote(user_agent)];

    if (isWindows()) {
      args.push(
        '--config',
        quote(this.options.getConfigFile(false)),
        '--logfile',
        quote(this.options.getLogFile()),
      );
    }

    const binary = this.dependencies.getCliLocation();
    this.logger.debug(
      `Fetching coding activity for Today from api: ${formatArguments(binary, args)}`,
    );
    const options = buildOptions();
    const proc = child_process.execFile(
      binary,
      args,
      options,
      (error, stdout, stderr) => {
        if (error != null) {
          if (stderr && stderr.toString() !== '')
            this.logger.error(stderr.toString());
          if (stdout && stdout.toString() !== '')
            this.logger.error(stdout.toString());
          this.logger.error(error.toString());
        }
      },
    );
    let output = '';
    if (proc.stdout) {
      proc.stdout.on('data', (data: string | null) => {
        if (data) output += data;
      });
    }
    proc.on('close', (code, _signal) => {
      if (code === 0) {
        if (this.showStatusBar) {
          if (output?.trim()) {
            if (this.showCodingActivity) {
              this.updateStatusBarText(output.trim());
              this.updateStatusBarTooltip('WakaTime: Today’s coding time.');
            } else {
              this.updateStatusBarText();
              this.updateStatusBarTooltip(output.trim());
            }
          } else {
            this.updateStatusBarText();
            this.updateStatusBarTooltip(
              'WakaTime: Calculating time spent today in background...',
            );
          }
        }
      } else if (code === 102 || code === 112) {
        // noop, working offline
      } else {
        const error_msg = `Error fetching today coding activity (${code}); Check your ${this.options.getLogFile()} file for more details`;
        this.logger.debug(error_msg);
      }
    });
  }
}

class ApiKeyModal extends Modal {
  options: Options;
  input: TextComponent;
  private static instance: ApiKeyModal;

  // biome-ignore lint/correctness/noUnreachableSuper: Singleton pattern
  constructor(app: App, options: Options) {
    if (ApiKeyModal.instance) {
      // biome-ignore lint/correctness/noConstructorReturn: Singleton pattern
      return ApiKeyModal.instance;
    }
    super(app);
    this.options = options;
    ApiKeyModal.instance = this;
  }

  async onOpen() {
    const { contentEl } = this;

    const api_key = await this.options.getSettingAsync('settings', 'api_key');
    let defaultVal = api_key?.value || '';
    if (apiKeyInvalid(defaultVal)) {
      defaultVal = '';
    }

    contentEl.createEl('h2', { text: 'Enter your WakaTime API Key' });

    new Setting(contentEl).addText((text) => {
      text.setValue(defaultVal);
      text.inputEl.addClass('api-key-input');
      this.input = text;
    });

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText('Save')
        .setCta()
        .onClick(() => {
          const val = this.input.getValue();
          const invalid = apiKeyInvalid(val);
          console.log(invalid);
          if (!invalid) {
            this.close();
            this.options.setSetting('settings', 'api_key', val, false);
          }
        }),
    );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
