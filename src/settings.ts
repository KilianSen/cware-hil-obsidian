import { PluginSettingTab, Setting, type App } from "obsidian";
import type CcHitlPlugin from "./main.js";

export interface HitlSettings {
  host: string;
  port: number;
  token: string;
  noticeOnQuestion: boolean;
  soundOnQuestion: boolean;
  systemNotification: boolean;
}

export const DEFAULT_SETTINGS: HitlSettings = {
  host: "127.0.0.1",
  port: 22360,
  token: "",
  noticeOnQuestion: true,
  soundOnQuestion: false,
  systemNotification: false,
};

export class HitlSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: CcHitlPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Hub host")
      .setDesc("Host the cc-hitl hub is bound to (almost always 127.0.0.1).")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.host)
          .onChange(async (v) => {
            this.plugin.settings.host = v.trim() || "127.0.0.1";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Hub port")
      .setDesc("Port from `cc-hitl status` (default 22360).")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.port)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) {
            this.plugin.settings.port = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName("Bearer token")
      .setDesc("From `cc-hitl token`. Required to connect to the bridge.")
      .addText((t) => {
        t.setValue(this.plugin.settings.token).onChange(async (v) => {
          this.plugin.settings.token = v.trim();
          await this.plugin.saveSettings();
        });
        t.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("Notice on new question")
      .setDesc("Show an Obsidian notice whenever an agent asks a new question.")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.noticeOnQuestion).onChange(async (v) => {
          this.plugin.settings.noticeOnQuestion = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Sound on new question")
      .setDesc("Play a short beep when a new question arrives.")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.soundOnQuestion).onChange(async (v) => {
          this.plugin.settings.soundOnQuestion = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("System notification")
      .setDesc("Show an OS-level desktop notification on new questions (works even when Obsidian isn't focused).")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.systemNotification).onChange(async (v) => {
          this.plugin.settings.systemNotification = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).addButton((b) =>
      b
        .setButtonText("Reconnect")
        .setCta()
        .onClick(() => this.plugin.reconnect()),
    );
  }
}
