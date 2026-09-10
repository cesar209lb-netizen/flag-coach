// Backup to a single JSON file (share sheet → Files/iCloud Drive/AirDrop) and restore.

import { snapshot, restoreSnapshot, saveSettings, state } from './store.js';
import { confirmDialog, toast } from './ui.js';

export async function saveBackup() {
  const data = snapshot();
  const stamp = new Date().toISOString().slice(0, 10);
  const safeTeam = (state.settings.teamName || 'Team').replace(/[^\w-]+/g, '-');
  const name = `FlagCoach-${safeTeam}-${stamp}.json`;
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Flag Coach backup' });
      await saveSettings({ lastBackupAt: Date.now() });
      toast('Backup saved');
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  await saveSettings({ lastBackupAt: Date.now() });
  toast('Backup downloaded');
  return true;
}

export function restoreBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    input.remove();
    if (!f) return;
    let data;
    try {
      data = JSON.parse(await f.text());
    } catch {
      toast("That file isn't a Flag Coach backup", { tone: 'bad' });
      return;
    }
    if (data?.app !== 'flag-coach' || !Array.isArray(data.plays)) {
      toast("That file isn't a Flag Coach backup", { tone: 'bad' });
      return;
    }
    const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'unknown date';
    const ok = await confirmDialog({
      title: 'Restore this backup?',
      message: `Backup from ${when}: ${data.plays.length} plays, ${data.players?.length || 0} players, ${data.seasons?.length || 0} seasons. Everything currently on this iPad will be replaced.`,
      confirmText: 'Replace & restore', danger: true,
    });
    if (!ok) return;
    await restoreSnapshot(data);
    toast('Backup restored');
  });
  document.body.append(input);
  input.click();
}
