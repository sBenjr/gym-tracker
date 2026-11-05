import { backupFileName, type Backup } from './domain/backup'

export type SaveResult = 'sent' | 'downloaded' | 'cancelled'

/** Android may refuse to share .json files, so a plain text copy of the same contents is the fallback. */
function shareableFile(text: string, at: number): File | undefined {
  const options = [
    new File([text], backupFileName(at, 'json'), { type: 'application/json' }),
    new File([text], backupFileName(at, 'txt'), { type: 'text/plain' }),
  ]
  return options.find((file) => navigator.canShare?.({ files: [file] }))
}

export function canSendFiles(): boolean {
  return shareableFile('', Date.now()) !== undefined
}

export function downloadBackup(backup: Backup, prefix?: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = backupFileName(backup.exportedAt, 'json', prefix)
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Opens the phone's share sheet, or downloads the file where sharing isn't available or fails. */
export async function sendBackup(backup: Backup): Promise<SaveResult> {
  const file = shareableFile(JSON.stringify(backup), backup.exportedAt)
  if (file) {
    try {
      await navigator.share({ files: [file], title: 'Gym Tracker backup' })
      return 'sent'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    }
  }
  downloadBackup(backup)
  return 'downloaded'
}
