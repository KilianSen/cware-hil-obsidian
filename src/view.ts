import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { Agent, Question, QuestionStatus } from "cware-hil-lib";
import type { HubClient } from "./hubClient.js";

export const VIEW_TYPE_HITL = "cc-hitl-view";

const nowIso = (): string => new Date().toISOString();

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

type Tab = "pending" | "history" | "agents";
const HISTORY_STATUSES: QuestionStatus[] = ["answered", "cancelled", "expired"];

/**
 * The right-sidebar panel. Three tabs: pending questions with inline answer
 * controls, a read-only history view, and a live agent dashboard (with remove /
 * message controls). Reads its state from the shared {@link HubClient}; the
 * plugin calls {@link render} on every change.
 */
export class HitlView extends ItemView {
  private activeTab: Tab = "pending";
  private historyRows: Question[] = [];
  private historyStatuses = new Set<QuestionStatus>(["answered"]);
  private historyLoading = false;
  private historyError: string | null = null;
  private messageDrafts = new Map<string, string>();

  constructor(
    leaf: WorkspaceLeaf,
    private client: HubClient,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_HITL;
  }

  getDisplayText(): string {
    return "Claude Code HITL";
  }

  getIcon(): string {
    return "message-circle-question";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  render(): void {
    const c = this.contentEl;
    c.empty();
    c.addClass("cc-hitl");

    const header = c.createDiv({ cls: "cc-hitl-header" });
    header.createEl("h4", { text: "Claude Code HITL" });
    header.createSpan({
      cls: `cc-hitl-status ${this.client.connected ? "is-connected" : "is-disconnected"}`,
      text: this.client.connected ? "● connected" : "● disconnected",
    });

    this.renderTabs(c);

    if (this.activeTab === "pending") this.renderPendingTab(c);
    else if (this.activeTab === "history") this.renderHistoryTab(c);
    else this.renderAgentsTab(c);
  }

  private renderTabs(c: HTMLElement): void {
    const pendingCount = [...this.client.questions.values()].filter(
      (q) => q.status === "pending",
    ).length;
    const tabs = c.createDiv({ cls: "cc-hitl-tabs" });
    const mk = (tab: Tab, label: string) => {
      const btn = tabs.createEl("button", {
        cls: `cc-hitl-tab ${this.activeTab === tab ? "is-active" : ""}`,
        text: label,
      });
      btn.onclick = () => {
        this.activeTab = tab;
        if (tab === "history") void this.loadHistory();
        else this.render();
      };
    };
    mk("pending", `Pending (${pendingCount})`);
    mk("history", "History");
    mk("agents", `Agents (${this.client.agents.size})`);
  }

  // --- Pending tab ----------------------------------------------------------

  private renderPendingTab(c: HTMLElement): void {
    const pending = [...this.client.questions.values()]
      .filter((q) => q.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const qSec = c.createDiv({ cls: "cc-hitl-section" });
    if (!pending.length) {
      qSec.createDiv({
        cls: "cc-hitl-empty",
        text: this.client.connected ? "Nothing waiting on you." : "Not connected to the hub.",
      });
    }
    for (const q of pending) this.renderQuestion(qSec.createDiv({ cls: "cc-hitl-card" }), q);
  }

  // --- History tab ----------------------------------------------------------

  private async loadHistory(): Promise<void> {
    this.historyLoading = true;
    this.historyError = null;
    this.render();
    try {
      const res = await this.client.requestHistory({
        statuses: [...this.historyStatuses],
        limit: 50,
      });
      this.historyRows = res.questions;
    } catch (e) {
      this.historyError = (e as Error).message;
    } finally {
      this.historyLoading = false;
      this.render();
    }
  }

  private renderHistoryTab(c: HTMLElement): void {
    const sec = c.createDiv({ cls: "cc-hitl-section" });
    const filters = sec.createDiv({ cls: "cc-hitl-filters" });
    for (const s of HISTORY_STATUSES) {
      const btn = filters.createEl("button", {
        cls: `cc-hitl-chip ${this.historyStatuses.has(s) ? "is-active" : ""}`,
        text: s,
      });
      btn.onclick = () => {
        if (this.historyStatuses.has(s)) this.historyStatuses.delete(s);
        else this.historyStatuses.add(s);
        void this.loadHistory();
      };
    }
    const refresh = filters.createEl("button", { cls: "cc-hitl-chip", text: "↻" });
    refresh.onclick = () => void this.loadHistory();

    if (this.historyError) {
      sec.createDiv({ cls: "cc-hitl-empty", text: `Couldn't load history: ${this.historyError}` });
      return;
    }
    if (this.historyLoading && !this.historyRows.length) {
      sec.createDiv({ cls: "cc-hitl-empty", text: "Loading…" });
      return;
    }
    if (!this.historyRows.length) {
      sec.createDiv({ cls: "cc-hitl-empty", text: "No matching history." });
      return;
    }
    for (const q of this.historyRows) this.renderHistoryCard(sec.createDiv({ cls: "cc-hitl-card" }), q);
  }

  private renderHistoryCard(card: HTMLElement, q: Question): void {
    const head = card.createDiv({ cls: "cc-hitl-card-head" });
    head.createSpan({ cls: "cc-hitl-kind", text: q.kind.replace("_", " ") });
    head.createSpan({ cls: `cc-hitl-badge status-${q.status}`, text: q.status });
    if (q.priority && q.priority !== "normal")
      head.createSpan({ cls: "cc-hitl-prio", text: q.priority });
    head.createSpan({ cls: "cc-hitl-card-agent", text: relativeTime(q.createdAt) });

    card.createDiv({ cls: "cc-hitl-card-title", text: q.title });
    const ctx = q.prompt ?? q.approval?.body;
    if (ctx) card.createDiv({ cls: "cc-hitl-prompt", text: ctx });
    const ans = card.createDiv({ cls: "cc-hitl-answer" });
    ans.createSpan({ cls: "cc-hitl-answer-label", text: "Answer: " });
    ans.createSpan({ text: historyAnswer(q) });
  }

  // --- Agents tab -----------------------------------------------------------

  private renderAgentsTab(c: HTMLElement): void {
    const agents = [...this.client.agents.values()].sort((a, b) =>
      a.startedAt.localeCompare(b.startedAt),
    );
    const aSec = c.createDiv({ cls: "cc-hitl-section" });
    if (!agents.length) aSec.createDiv({ cls: "cc-hitl-empty", text: "No agents yet." });
    for (const a of agents) this.renderAgent(aSec.createDiv({ cls: "cc-hitl-agent" }), a);
  }

  private renderQuestion(card: HTMLElement, q: Question): void {
    const head = card.createDiv({ cls: "cc-hitl-card-head" });
    head.createSpan({ cls: "cc-hitl-kind", text: q.kind.replace("_", " ") });
    if (q.priority && q.priority !== "normal")
      head.createSpan({ cls: "cc-hitl-prio", text: q.priority });
    const agentLabel = this.client.agents.get(q.agentId)?.label;
    if (agentLabel) head.createSpan({ cls: "cc-hitl-card-agent", text: agentLabel });

    card.createDiv({ cls: "cc-hitl-card-title", text: q.title });

    if (q.kind === "ask_user") this.renderAskUser(card, q);
    else if (q.kind === "ask_choice") this.renderAskChoice(card, q);
    else if (q.kind === "request_approval") this.renderApproval(card, q);

    const actions = card.createDiv({ cls: "cc-hitl-actions" });
    const dismiss = actions.createEl("button", { text: "Dismiss" });
    dismiss.onclick = () => this.client.cancelQuestion(q.id);
    this.attachPrimary(card, q, actions);
  }

  private renderAskUser(card: HTMLElement, q: Question): void {
    if (q.prompt) card.createDiv({ cls: "cc-hitl-prompt", text: q.prompt });
    const ta = card.createEl("textarea", { cls: "cc-hitl-textarea" });
    ta.rows = 3;
    ta.placeholder = "Type your answer…";
    card.dataset.qid = q.id;
    (card as HTMLElement & { _getAnswer?: () => unknown })._getAnswer = () => ({
      questionId: q.id,
      kind: "ask_user",
      text: ta.value,
      answeredAt: nowIso(),
    });
  }

  private renderAskChoice(card: HTMLElement, q: Question): void {
    if (q.prompt) card.createDiv({ cls: "cc-hitl-prompt", text: q.prompt });
    const inputs: HTMLInputElement[] = [];
    for (const ch of q.choices ?? []) {
      const label = card.createEl("label", { cls: "cc-hitl-choice" });
      const input = label.createEl("input", { type: q.multi ? "checkbox" : "radio" });
      input.name = `q-${q.id}`;
      input.value = ch.id;
      label.createSpan({ text: " " + ch.label });
      inputs.push(input);
    }
    const note = card.createEl("textarea", { cls: "cc-hitl-textarea" });
    note.rows = 2;
    note.placeholder = "Add a note (optional)…";
    (card as HTMLElement & { _getAnswer?: () => unknown })._getAnswer = () => ({
      questionId: q.id,
      kind: "ask_choice",
      choiceIds: inputs.filter((i) => i.checked).map((i) => i.value),
      text: note.value.trim() || undefined,
      answeredAt: nowIso(),
    });
  }

  private renderApproval(card: HTMLElement, q: Question): void {
    if (q.approval?.body) card.createDiv({ cls: "cc-hitl-prompt", text: q.approval.body });
    if (q.approval?.diff) card.createEl("pre", { cls: "cc-hitl-diff", text: q.approval.diff });
    const comment = card.createEl("input", { type: "text", cls: "cc-hitl-comment" });
    comment.placeholder = "Comment (optional)…";
    (card as HTMLElement & { _approvalComment?: HTMLInputElement })._approvalComment = comment;
  }

  /** Wire up the primary action button(s) per kind. */
  private attachPrimary(card: HTMLElement, q: Question, actions: HTMLElement): void {
    if (q.kind === "request_approval") {
      const comment = (card as HTMLElement & { _approvalComment?: HTMLInputElement })
        ._approvalComment;
      const reject = actions.createEl("button", { text: "Reject", cls: "mod-warning" });
      reject.onclick = () =>
        this.client.submitAnswer({
          questionId: q.id,
          kind: "request_approval",
          decision: "reject",
          comment: comment?.value || undefined,
          answeredAt: nowIso(),
        });
      const approve = actions.createEl("button", { text: "Approve", cls: "mod-cta" });
      approve.onclick = () =>
        this.client.submitAnswer({
          questionId: q.id,
          kind: "request_approval",
          decision: "approve",
          comment: comment?.value || undefined,
          answeredAt: nowIso(),
        });
      return;
    }
    const submit = actions.createEl("button", { text: "Submit", cls: "mod-cta" });
    submit.onclick = () => {
      const getAnswer = (card as HTMLElement & { _getAnswer?: () => never })._getAnswer;
      if (getAnswer) this.client.submitAnswer(getAnswer());
    };
  }

  private renderAgent(row: HTMLElement, a: Agent): void {
    const top = row.createDiv({ cls: "cc-hitl-agent-top" });
    top.createSpan({ cls: "cc-hitl-agent-label", text: a.label ?? a.agentId.slice(0, 8) });
    top.createSpan({ cls: `cc-hitl-badge status-${a.status}`, text: a.status });
    top.createSpan({ cls: "cc-hitl-agent-seen", text: relativeTime(a.lastSeen) });
    if (a.currentTask) row.createDiv({ cls: "cc-hitl-agent-task", text: a.currentTask });
    if (typeof a.progress === "number") {
      const bar = row.createDiv({ cls: "cc-hitl-progress" });
      bar.createDiv({ cls: "cc-hitl-progress-fill" }).style.width =
        `${Math.round(a.progress * 100)}%`;
    }

    // Reverse channel + removal controls.
    const controls = row.createDiv({ cls: "cc-hitl-agent-controls" });
    const input = controls.createEl("input", { type: "text", cls: "cc-hitl-agent-msg" });
    input.placeholder = "Message this agent…";
    input.value = this.messageDrafts.get(a.agentId) ?? "";
    input.oninput = () => this.messageDrafts.set(a.agentId, input.value);
    const send = controls.createEl("button", { text: "Send" });
    send.onclick = () => {
      const text = input.value.trim();
      if (!text) return;
      this.client.sendToAgent(a.stableId ?? a.agentId, text);
      this.messageDrafts.delete(a.agentId);
      input.value = "";
    };
    const remove = controls.createEl("button", { text: "Remove", cls: "mod-warning" });
    remove.onclick = () => this.client.removeAgent(a.agentId);
  }
}

function historyAnswer(q: Question): string {
  const a = q.answer;
  if (!a) return q.status === "pending" ? "— still waiting —" : "— no answer —";
  if (a.kind === "ask_user") return a.text || "(empty)";
  if (a.kind === "ask_choice") {
    const labels = (a.choiceIds ?? [])
      .map((id) => q.choices?.find((c) => c.id === id)?.label ?? id)
      .join(", ");
    return a.text ? `${labels || "(none)"} — note: ${a.text}` : labels || "(none)";
  }
  return a.comment ? `${a.decision} — ${a.comment}` : (a.decision ?? "—");
}
