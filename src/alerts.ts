/** Sound + OS-notification helpers for the Obsidian plugin (Electron renderer). */

let audioCtx: AudioContext | null = null;

/** Play a short two-tone beep using WebAudio (no asset needed). */
export function playBeep(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx ??= new Ctx();
    const ctx = audioCtx;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.setValueAtTime(880, now + 0.12);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.36);
  } catch {
    /* ignore */
  }
}

/** Fire an OS notification (best-effort; Electron usually allows this). */
export function osNotify(title: string, body?: string): void {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      new Notification(title, { body });
    } else if (Notification.permission !== "denied") {
      void Notification.requestPermission().then((p) => {
        if (p === "granted") new Notification(title, { body });
      });
    }
  } catch {
    /* ignore */
  }
}
