import {
  BRIDGE_PROTOCOL_VERSION,
  parseServerMessage,
  type Agent,
  type Answer,
  type Notification,
  type Question,
} from "cware-hil-lib";

export interface HubConnectionConfig {
  host: string;
  port: number;
  token: string;
}

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

/**
 * Connects to the hub's `/bridge` WebSocket using the renderer's native
 * WebSocket. Maintains a local mirror of pending questions and the agent
 * registry, reconnects with exponential backoff + jitter, and reconciles via a
 * fresh snapshot on every (re)connect. If a sequence gap is detected it forces
 * a reconnect to resync.
 */
export class HubClient {
  readonly questions = new Map<string, Question>();
  readonly agents = new Map<string, Agent>();
  connected = false;

  /** UI hooks — set by the view/plugin. */
  onChange: () => void = () => {};
  onNotify: (n: Notification) => void = () => {};
  onConnectionChange: (connected: boolean) => void = () => {};

  private cfg: HubConnectionConfig;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSeq = 0;
  private stopped = true;
  private readonly clientId = "obsidian-" + Math.random().toString(36).slice(2, 10);

  constructor(cfg: HubConnectionConfig) {
    this.cfg = cfg;
  }

  connect(): void {
    this.stopped = false;
    this.open();
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
  }

  /** Apply new connection settings and reconnect. */
  setConfig(cfg: HubConnectionConfig): void {
    this.cfg = cfg;
    this.disconnect();
    this.connect();
  }

  submitAnswer(answer: Answer): void {
    this.sendRaw({ type: "answer", answer });
  }

  cancelQuestion(questionId: string): void {
    this.sendRaw({ type: "cancel_question", questionId });
  }

  // --- internals ------------------------------------------------------------

  private open(): void {
    const { host, port, token } = this.cfg;
    const url = `ws://${host}:${port}/bridge?token=${encodeURIComponent(token)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.sendRaw({
        type: "hello",
        clientId: this.clientId,
        token: this.cfg.token,
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
      });
    };
    ws.onmessage = (ev) => this.handleMessage(String(ev.data));
    ws.onclose = () => {
      this.setConnected(false);
      if (!this.stopped) this.scheduleReconnect();
    };
    ws.onerror = () => {
      // an error is always followed by a close; reconnect handled there
    };
  }

  private handleMessage(raw: string): void {
    let msg;
    try {
      msg = parseServerMessage(raw);
    } catch {
      return;
    }

    // Sequence-gap detection (snapshot resets the baseline).
    if (msg.type === "snapshot") {
      this.lastSeq = msg.seq;
    } else if (msg.seq > this.lastSeq + 1) {
      // We missed a frame — force a reconnect to get a fresh snapshot.
      this.ws?.close();
      return;
    } else if (msg.seq > this.lastSeq) {
      this.lastSeq = msg.seq;
    }

    switch (msg.type) {
      case "snapshot":
        this.questions.clear();
        this.agents.clear();
        for (const q of msg.questions) this.questions.set(q.id, q);
        for (const a of msg.agents) this.agents.set(a.agentId, a);
        this.reconnectAttempts = 0;
        this.setConnected(true);
        this.onChange();
        break;
      case "question_created":
      case "question_updated":
        if (msg.question.status === "pending") this.questions.set(msg.question.id, msg.question);
        else this.questions.delete(msg.question.id);
        this.onChange();
        break;
      case "agent_updated":
        this.agents.set(msg.agent.agentId, msg.agent);
        this.onChange();
        break;
      case "agent_removed":
        this.agents.delete(msg.agentId);
        this.onChange();
        break;
      case "notify":
        this.onNotify(msg.notification);
        break;
      case "pong":
        break;
    }
  }

  private setConnected(connected: boolean): void {
    if (this.connected === connected) return;
    this.connected = connected;
    this.onConnectionChange(connected);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay =
      Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** this.reconnectAttempts) +
      Math.random() * 500;
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private sendRaw(obj: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }
}
