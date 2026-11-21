import { matchRates, type Counts } from '../shared/matchAnalytics';

export interface RecapEntry {
  source: string;
  moment: string;
  detail: string;
}

export class MatchRecap {
  private request?: AbortController;

  constructor(
    private readonly dialog: HTMLDialogElement,
    private readonly list: HTMLOListElement,
    private readonly analysis: HTMLElement,
    private readonly outcome: HTMLElement,
  ) {}

  open(outcome: string, counts: Counts): void {
    this.outcome.textContent = outcome;
    this.dialog.showModal();
    if (this.list.childElementCount) return;
    const rates = matchRates(counts);
    for (const { label, count, total } of rates) {
      const item = document.createElement('li');
      const row = document.createElement('div');
      const name = document.createElement('strong');
      const value = document.createElement('span');
      name.textContent = label;
      value.textContent = total ? `${count} of ${total} · ${Math.round(count / total * 100)}%` : 'No opportunities';
      row.append(name, value);
      item.append(row);
      this.list.append(item);
    }
    if (!rates.some(row => row.total)) {
      this.analysis.textContent = 'No actions recorded this match.';
      return;
    }
    this.request = new AbortController();
    void this.interpret(counts, this.request.signal);
  }

  private async interpret(counts: Counts, signal: AbortSignal) {
    this.analysis.textContent = 'Gemini 4 Hydrogen is reviewing the match…';
    try {
      const response = await fetch('/api/match/analysis', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(counts), signal,
      });
      if (!response.ok) throw new Error();
      const { summary } = await response.json();
      if (typeof summary !== 'string' || !summary.trim()) throw new Error();
      if (!signal.aborted) this.analysis.textContent = 'Gemini 4 Hydrogen · ' + summary;
    } catch {
      if (!signal.aborted) this.analysis.textContent = 'Gemini commentary is unavailable. The observed match rates are below.';
    }
  }

  reset(): void {
    this.request?.abort();
    this.dialog.close();
    this.list.replaceChildren();
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }
}
