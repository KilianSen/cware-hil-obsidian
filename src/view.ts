import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { Agent, Question } from "cware-hil-lib";
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

/**
 * The right-sidebar panel: a list of pending questions with inline answer
 * controls, and a live dashboard of connected agents. Reads its state from the
 * shared {@link HubClient}; the plugin calls {@link render} on every change.
 */
export class HitlView extends ItemView {
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

    // --- Pending questions ---
    const pending = [...this.client.questions.values()]
      .filter((q) => q.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const qSec = c.createDiv({ cls: "cc-hitl-section" });
    qSec.createDiv({ cls: "cc-hitl-section-title", text: `Pending questions (${pending.length})` });
    if (!pending.length) {
      qSec.createDiv({
        cls: "cc-hitl-empty",
        text: this.client.connected ? "Nothing waiting on you." : "Not connected to the hub.",
      });
    }
    for (const q of pending) this.renderQuestion(qSec.createDiv({ cls: "cc-hitl-card" }), q);

    // --- Agent dashboard ---
    const agents = [...this.client.agents.values()].sort((a, b) =>
      a.startedAt.localeCompare(b.startedAt),
    );
    const aSec = c.createDiv({ cls: "cc-hitl-section" });
    aSec.createDiv({ cls: "cc-hitl-section-title", text: `Agents (${agents.length})` });
    if (!agents.length) aSec.createDiv({ cls: "cc-hitl-empty", text: "No agents yet." });
    for (const a of agents) this.renderAgent(aSec.createDiv({ cls: "cc-hitl-agent" }), a);
  }

  private renderQuestion(card: HTMLElement, q: Question): void {
    const head = card.createDiv({ cls: "cc-hitl-card-head" });
    head.createSpan({ cls: "cc-hitl-kind", text: q.kind.replace("_", " ") });
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
  }
}
