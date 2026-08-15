/**
 * Dialogs — Modal confirmation / info / error dialogs.
 */

import { AudioManager } from '../audio/AudioManager';

export interface DialogOptions {
  title: string;
  message: string;
  buttons: Array<{ label: string; value: string; primary?: boolean; danger?: boolean }>;
}

export class Dialogs {
  private backdrop: HTMLElement;
  private audio = AudioManager.get();

  constructor(root: HTMLElement) {
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'dialog-backdrop';
    root.appendChild(this.backdrop);
  }

  confirm(title: string, message: string): Promise<boolean> {
    return this.show({
      title,
      message,
      buttons: [
        { label: 'Cancel', value: 'no' },
        { label: 'Confirm', value: 'yes', primary: true },
      ],
    }).then((v) => v === 'yes');
  }

  alert(title: string, message: string): Promise<string> {
    return this.show({ title, message, buttons: [{ label: 'OK', value: 'ok', primary: true }] });
  }

  show(options: DialogOptions): Promise<string> {
    return new Promise((resolve) => {
      this.backdrop.innerHTML = '';
      const dialog = document.createElement('div');
      dialog.className = 'dialog panel';
      dialog.innerHTML = `<div class="dialog-title">${options.title}</div><div class="dialog-msg">${options.message}</div>`;
      const btns = document.createElement('div');
      btns.className = 'dialog-btns';
      for (const b of options.buttons) {
        const btn = document.createElement('button');
        btn.className = `btn small ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}`;
        btn.textContent = b.label;
        btn.onclick = () => {
          this.audio.uiClick();
          this.close();
          resolve(b.value);
        };
        btns.appendChild(btn);
      }
      dialog.appendChild(btns);
      this.backdrop.appendChild(dialog);
      this.backdrop.classList.add('visible');
    });
  }

  close(): void {
    this.backdrop.classList.remove('visible');
  }

  get isOpen(): boolean {
    return this.backdrop.classList.contains('visible');
  }
}
