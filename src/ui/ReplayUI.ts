/**
 * ReplayUI — Replay browser, timeline, playback controls.
 */

import { EventBus, Events } from '../core/EventBus';
import { AudioManager } from '../audio/AudioManager';
import { ReplayManager } from '../replay/ReplayManager';
import { formatTime } from '../core/Config';

export class ReplayUI {
  private el: HTMLElement;
  private bus = EventBus.get();
  private audio = AudioManager.get();
  private replay: ReplayManager;
  private timeline!: HTMLInputElement;
  private timeLabel!: HTMLElement;
  private playBtn!: HTMLButtonElement;
  onExit: (() => void) | null = null;

  constructor(root: HTMLElement, replay: ReplayManager) {
    this.replay = replay;
    this.el = document.createElement('div');
    this.el.id = 'replay-ui';
    this.el.className = 'screen';
    root.appendChild(this.el);
  }

  show(): void {
    this.el.classList.add('visible');
    this.render();
  }

  hide(): void {
    this.el.classList.remove('visible');
  }

  private render(): void {
    this.el.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'replay-bar';

    this.timeline = document.createElement('input');
    this.timeline.type = 'range';
    this.timeline.className = 'replay-timeline';
    this.timeline.min = '0';
    this.timeline.max = String(this.replay.playback.duration || 1);
    this.timeline.step = '0.01';
    this.timeline.value = '0';
    this.timeline.oninput = () => {
      this.replay.seek(parseFloat(this.timeline.value));
    };
    bar.appendChild(this.timeline);

    const controls = document.createElement('div');
    controls.className = 'replay-controls';

    const mkBtn = (label: string, fn: () => void, title = '') => {
      const b = document.createElement('button');
      b.className = 'btn icon-btn';
      b.innerHTML = label;
      b.title = title;
      b.onclick = () => {
        this.audio.uiClick();
        fn();
      };
      controls.appendChild(b);
      return b;
    };

    mkBtn('⏮', () => this.replay.seek(0), 'Restart');
    mkBtn('⏪', () => this.replay.stepFrame(-1), 'Frame back');
    this.playBtn = mkBtn('⏸', () => {
      if (this.replay.state === 'playing') this.replay.pause();
      else this.replay.resume();
    }, 'Play/Pause');
    mkBtn('⏩', () => this.replay.stepFrame(1), 'Frame forward');

    // Speed
    const speedSeg = document.createElement('div');
    speedSeg.className = 'seg-group';
    for (const spd of [0.25, 0.5, 1, 2, 4]) {
      const b = document.createElement('button');
      b.className = `seg-btn ${this.replay.playbackSpeed === spd ? 'active' : ''}`;
      b.textContent = `${spd}x`;
      b.onclick = () => {
        this.audio.uiClick();
        this.replay.playbackSpeed = spd;
        speedSeg.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
      };
      speedSeg.appendChild(b);
    }
    controls.appendChild(speedSeg);

    this.timeLabel = document.createElement('span');
    this.timeLabel.className = 'replay-time';
    controls.appendChild(this.timeLabel);

    mkBtn('💾', () => this.replay.saveRecording(), 'Save replay');
    mkBtn('📂', () => this.showBrowser(), 'Replay browser');
    mkBtn('✕', () => this.onExit?.(), 'Exit replay');

    bar.appendChild(controls);
    this.el.appendChild(bar);
  }

  /** Called each frame while replay UI is visible. */
  update(): void {
    if (!this.el.classList.contains('visible')) return;
    const pb = this.replay.playback;
    if (document.activeElement !== this.timeline) {
      this.timeline.max = String(pb.duration || 1);
      this.timeline.value = String(pb.time);
    }
    this.timeLabel.textContent = `${formatTime(pb.time)} / ${formatTime(pb.duration)}`;
    this.playBtn.innerHTML = pb.state === 'playing' ? '⏸' : '▶';
  }

  private showBrowser(): void {
    const replays = this.replay.getSavedReplays();
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop visible';
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.style.cssText = 'width:min(520px,94vw);max-height:80vh;overflow-y:auto';
    panel.innerHTML = `<div class="menu-title" style="font-size:18px">Saved Replays</div>`;
    if (replays.length === 0) {
      panel.innerHTML += `<div style="color:var(--text-dim);text-align:center;padding:24px">No saved replays. Record a drive first!</div>`;
    }
    for (const r of replays) {
      const row = document.createElement('div');
      row.className = 'setting-row';
      row.innerHTML = `<div><div class="setting-label">${new Date(r.date).toLocaleString()}</div>
        <div class="setting-desc">${formatTime(r.duration)} · ${r.frames.length} frames</div></div>`;
      const btns = document.createElement('div');
      btns.style.display = 'flex';
      btns.style.gap = '6px';
      const play = document.createElement('button');
      play.className = 'btn small primary';
      play.textContent = 'Play';
      play.onclick = () => {
        this.audio.uiClick();
        this.replay.play(r);
        backdrop.remove();
        this.render();
      };
      const del = document.createElement('button');
      del.className = 'btn small danger';
      del.textContent = 'Delete';
      del.onclick = () => {
        this.audio.uiBack();
        this.replay.deleteReplay(r.id);
        backdrop.remove();
        this.showBrowser();
      };
      btns.appendChild(play);
      btns.appendChild(del);
      row.appendChild(btns);
      panel.appendChild(row);
    }
    const close = document.createElement('button');
    close.className = 'btn small';
    close.style.marginTop = '12px';
    close.textContent = 'Close';
    close.onclick = () => backdrop.remove();
    panel.appendChild(close);
    backdrop.appendChild(panel);
    backdrop.onclick = (e) => {
      if (e.target === backdrop) backdrop.remove();
    };
    this.el.appendChild(backdrop);
  }
}
