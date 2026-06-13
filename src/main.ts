import { Notice, Plugin, type WorkspaceLeaf } from "obsidian";
import type { Notification } from "cware-hil-lib";
import { HubClient } from "./hubClient.js";
import { HitlView, VIEW_TYPE_HITL } from "./view.js";
import { DEFAULT_SETTINGS, HitlSettingTab, type HitlSettings } from "./settings.js";

export default class CcHitlPlugin extends Plugin {
  declare settings: HitlSettings;
  client!: HubClient;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.client = new HubClient({
      host: this.settings.host,
      port: this.settings.port,
      token: this.settings.token,
    });
    this.client.onChange = () => this.refreshViews();
    this.client.onConnectionChange = (connected) => {
      this.refreshViews();
      new Notice(connected ? "cc-hitl: connected to hub" : "cc-hitl: hub connection lost");
    };
    this.client.onNotify = (n) => this.handleNotify(n);

    this.registerView(VIEW_TYPE_HITL, (leaf) => new HitlView(leaf, this.client));

    this.addRibbonIcon("message-circle-question", "Claude Code HITL", () => this.activateView());
    this.addCommand({
      id: "open-hitl-panel",
      name: "Open HITL panel",
      callback: () => this.activateView(),
    });

    this.addSettingTab(new HitlSettingTab(this.app, this));

    if (this.settings.token) this.client.connect();
    else new Notice("cc-hitl: set the hub token in settings to connect.");
  }

  onunload(): void {
    this.client?.disconnect();
  }

  private handleNotify(n: Notification): void {
    const prefix = n.level === "error" ? "⛔" : n.level === "warn" ? "⚠️" : "ℹ️";
    new Notice(`cc-hitl ${prefix} ${n.message}`);
  }

  /** Re-render every open HITL view; also surface a notice for new questions. */
  private lastQuestionCount = 0;
  private refreshViews(): void {
    const pending = [...this.client.questions.values()].filter((q) => q.status === "pending");
    if (
      this.settings.noticeOnQuestion &&
      pending.length > this.lastQuestionCount &&
      this.lastQuestionCount >= 0
    ) {
      const newest = pending[pending.length - 1];
      new Notice(`cc-hitl: new question — ${newest?.title ?? ""}`);
    }
    this.lastQuestionCount = pending.length;

    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HITL)) {
      const view = leaf.view;
      if (view instanceof HitlView) view.render();
    }
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_HITL)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: VIEW_TYPE_HITL, active: true });
    }
    if (leaf) workspace.revealLeaf(leaf);
  }

  reconnect(): void {
    this.client.setConfig({
      host: this.settings.host,
      port: this.settings.port,
      token: this.settings.token,
    });
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
