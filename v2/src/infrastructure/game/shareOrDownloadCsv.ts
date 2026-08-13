// DOM-bijwerkende poort van v1's `shareOrDownloadCsv()` (index.html regel
// 1160-1175): Web Share API met bestand indien beschikbaar, anders
// blob-download via een tijdelijke `<a download>`. Bewust gescheiden van de
// pure CSV-opbouw in `domain/game/csv.ts` — zelfde patroon als
// `infrastructure/sync/exportPendingPayload.ts`.

export function shareOrDownloadCsv(csvText: string, filename: string, shareTitle: string): void {
  const blob = new Blob([csvText], { type: 'text/csv' });
  let file: File | null = null;
  try {
    file = new File([blob], filename, { type: 'text/csv' });
  } catch {
    file = null;
  }

  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files: File[]; title: string }) => Promise<void>;
  };
  if (file && nav.share && nav.canShare?.({ files: [file] })) {
    nav.share({ files: [file], title: shareTitle }).catch(() => {});
    return;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
