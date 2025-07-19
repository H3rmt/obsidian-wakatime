# WakaTime for Obsidian

[WakaTime][wakatime] is an open source Obsidian plugin for metrics, insights, and time tracking automatically generated
from your Obsidian usage activity.

## Installation

Look at the lastest release.
This plugin is not available in the Obsidian plugin store, so you will need to install the official WakaTime plugin
manually and replace the files with the ones in this repository.

## Usage

Visit [https://wakatime.com](https://wakatime.com) to see your coding activity.

![Project Overview](https://wakatime.com/static/img/ScreenShots/Screen-Shot-2016-03-21.png)

To edit your api key, open the `Command Palette` then type `WakaTime` and select the `WakaTime API Key` command.

## Troubleshooting

The [How to Debug Plugins][how to debug] guide shows how to check when coding activity was last received from your
editor using the [Plugins Status Page][plugins status page].

For more general troubleshooting info, see the [wakatime-cli Troubleshooting Section][wakatime-cli help].

## Contributing

- Clone this repo.
- `pnpm install` to install dependencies
- `pnpm build` to build the plugin.
- `pnpm check` to check the code.

## Manually installing the plugin

- Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/your-plugin-id/`.

[wakatime]: https://wakatime.com/vs-code

[api key]: https://wakatime.com/api-key

[wakatime-cli help]: https://github.com/wakatime/wakatime-cli/blob/develop/TROUBLESHOOTING.md

[how to debug]: https://wakatime.com/faq#debug-plugins

[plugins status page]: https://wakatime.com/plugin-status
