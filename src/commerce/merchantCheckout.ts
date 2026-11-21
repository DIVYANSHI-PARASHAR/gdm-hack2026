import type { Checkout } from '../../server/shopMcp';
import { defaultJacketAddress, readJacketShipping, type JacketShipping } from '../shared/jacketShipping';

export function merchantWindow(): Window | null {
  const popup = window.open('about:blank', '_blank', 'popup,width=800,height=860');
  if (popup) {
    popup.opener = null;
    popup.document.title = 'Opening merchant checkout';
    popup.document.body.textContent = 'Opening merchant checkout…';
  }
  return popup;
}

export class MerchantCheckout {
  private dialog = document.querySelector<HTMLDialogElement>('#merchant-checkout')!;
  private form = this.dialog.querySelector<HTMLFormElement>('[data-delivery-form]')!;
  private summary = this.dialog.querySelector<HTMLElement>('[data-checkout-summary]')!;
  private item = this.dialog.querySelector<HTMLElement>('[data-checkout-item]')!;
  private status = this.dialog.querySelector<HTMLElement>('[data-checkout-status]')!;
  private details = this.dialog.querySelector<HTMLElement>('[data-checkout-details]')!;
  private continueLink = this.dialog.querySelector<HTMLAnchorElement>('[data-checkout-link]')!;
  private submit?: (shipping: JacketShipping, popup: Window | null) => void;
  get shipping(): JacketShipping | undefined {
    return readJacketShipping(Object.fromEntries(new FormData(this.form)));
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  constructor() {
    for (const [field, value] of Object.entries(defaultJacketAddress)) {
      const input = this.form.elements.namedItem(field) as HTMLInputElement;
      input.defaultValue = value;
    }
    this.dialog.querySelector<HTMLButtonElement>('[data-checkout-close]')!.onclick = () => this.close();
    this.form.onsubmit = (event) => {
      event.preventDefault();
      const shipping = this.shipping;
      if (!shipping) {
        this.dialog.querySelector<HTMLElement>('[data-delivery-error]')!.textContent = 'Check your email and country code.';
        return;
      }
      this.submit?.(shipping, merchantWindow());
    };
  }

  open(title: string, selected: string[]) {
    this.item.textContent = [title, ...selected].join(' · ');
    if (!this.dialog.open) this.dialog.showModal();
  }

  delivery(submit: (shipping: JacketShipping, popup: Window | null) => void) {
    this.submit = submit;
    this.summary.hidden = true;
    this.form.hidden = false;
  }

  loading() {
    this.form.hidden = true;
    this.summary.hidden = false;
    this.continueLink.hidden = true;
    this.continueLink.removeAttribute('href');
    this.details.replaceChildren();
    this.status.textContent = 'Preparing checkout…';
  }

  error(message: string) {
    this.status.textContent = message;
  }

  show(checkout: Checkout, popup: Window | null, format: (amount: number, currency: string) => string) {
    const total = checkout.totals?.find((entry) => entry.type === 'total');
    const price = total && checkout.currency ? format(total.amount, checkout.currency) : '';
    this.status.textContent = price ? `Order total · ${price}` : 'Checkout ready';
    this.continueLink.setAttribute('href', checkout.continue_url);
    this.continueLink.hidden = false;
    for (const total of checkout.totals ?? []) {
      if (!checkout.currency || typeof total.amount !== 'number') continue;
      const row = document.createElement('div');
      const label = document.createElement('span');
      const value = document.createElement('strong');
      label.textContent = total.display_text || total.type;
      value.textContent = format(total.amount, checkout.currency);
      row.append(label, value);
      this.details.append(row);
    }
    for (const message of checkout.messages ?? []) {
      if (!message.content || !['error', 'warning'].includes(message.type)) continue;
      const line = document.createElement('p');
      line.textContent = message.content;
      this.details.append(line);
    }
    for (const policy of checkout.links ?? []) {
      if (!policy.url?.startsWith('https://')) continue;
      const link = document.createElement('a');
      link.setAttribute('href', policy.url);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = policy.title || policy.type;
      this.details.append(link);
    }
    if (popup) {
      if (!popup.closed) popup.location.replace(checkout.continue_url);
    } else {
      window.location.assign(checkout.continue_url);
    }
  }

  close() {
    this.submit = undefined;
    this.dialog.close();
    this.continueLink.removeAttribute('href');
  }
}
