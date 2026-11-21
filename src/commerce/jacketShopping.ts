import type { Checkout, Selection, ShopProduct } from '../../server/shopMcp';
import { JacketVoice } from './jacketVoice';

type Results = {
  match: 'exact' | 'similar' | 'search';
  products: ShopProduct[];
  messages?: { type: string; content?: string }[];
};

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function link(label: string, url?: string) {
  if (!url?.startsWith('https://')) return;
  const anchor = node('a', label);
  anchor.setAttribute('href', url);
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  return anchor;
}

function money(amount: number, currency: string) {
  const format = new Intl.NumberFormat('en', { style: 'currency', currency });
  return format.format(amount / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2));
}

async function json<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Shopping is temporarily unavailable.');
  return body;
}

export class JacketShopping {
  private status: HTMLElement;
  private caption: HTMLElement;
  private voiceButton: HTMLButtonElement;
  private results: HTMLElement;
  private selectedPanel: HTMLElement;
  private searchInput: HTMLInputElement;
  private voiceActive = false;
  private session?: AbortController;
  private request?: AbortController;
  private products: ShopProduct[] = [];
  private prepareCheckout?: () => Promise<object>;
  private intro?: Promise<string>;
  private clearCaption = true;
  private voice = new JacketVoice(
    (status, active) => {
      this.status.textContent = status;
      this.voiceActive = active;
      this.voiceButton.textContent = active ? 'Stop voice' : 'Start voice';
    },
    (text, complete) => {
      if (text) {
        if (this.clearCaption) this.caption.textContent = '';
        this.caption.textContent += text;
      }
      this.clearCaption = complete;
    },
    async ({ name, args }) => {
      if (name === 'search_jackets' && typeof args?.query === 'string' && args.query.trim()) {
        return this.search(args.query.trim().slice(0, 240));
      }
      if (name === 'select_jacket' && typeof args?.number === 'number') {
        const product = this.products[args.number - 1];
        if (!product) return { error: 'Choose a result number shown in the current catalog.' };
        const options = Array.isArray(args.options) ? args.options : [];
        return this.select(product, options);
      }
      if (name === 'prepare_checkout') {
        return this.prepareCheckout?.() ?? { error: 'Select a jacket first.' };
      }
      return { error: 'Unsupported shopping request.' };
    },
  );

  constructor(root: HTMLElement) {
    this.status = root.querySelector<HTMLElement>('[data-voice-status]')!;
    this.caption = root.querySelector<HTMLElement>('[data-voice-caption]')!;
    this.voiceButton = root.querySelector<HTMLButtonElement>('[data-voice-button]')!;
    this.results = root.querySelector<HTMLElement>('[data-jacket-results]')!;
    this.selectedPanel = root.querySelector<HTMLElement>('[data-jacket-selection]')!;
    this.searchInput = root.querySelector<HTMLInputElement>('input')!;
    this.voiceButton.onclick = () => {
      if (this.voiceActive) {
        this.voice.stop();
        this.voiceActive = false;
        this.status.textContent = 'Microphone off';
        this.voiceButton.textContent = 'Start voice';
      } else if (this.intro) {
        void this.voice.start(this.intro);
      }
    };
    root.querySelector('form')!.onsubmit = (event) => {
      event.preventDefault();
      void this.search(this.searchInput.value.trim());
    };
  }

  open(autoVoice: boolean) {
    this.close();
    this.session = new AbortController();
    this.intro = this.search().then((result) =>
      'Greet the shopper, explain the initial lookup outcome and offer to help pick a size. Current Shop results: ' +
      JSON.stringify(result)
    );
    if (autoVoice) void this.voice.start(this.intro);
  }

  close() {
    this.session?.abort();
    this.session = undefined;
    this.request?.abort();
    this.voice.stop();
    this.voiceActive = false;
    this.voiceButton.textContent = 'Start voice';
    this.status.textContent = 'Microphone off';
    this.caption.textContent = '';
    this.clearCaption = true;
    this.prepareCheckout = undefined;
    this.selectedPanel.replaceChildren();
    this.results.replaceChildren();
    this.searchInput.value = '';
    this.products = [];
    this.intro = undefined;
  }

  private async search(query?: string) {
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.products = [];
    this.prepareCheckout = undefined;
    this.selectedPanel.replaceChildren();
    this.results.replaceChildren(node('p', 'Checking the live Shop catalog…'));
    try {
      const data = await json<Results>('/api/jacket/products' + (query ? '?q=' + encodeURIComponent(query) : ''), {
        signal: request.signal,
      });
      if (request.signal.aborted) return { error: 'Search replaced.' };
      this.products = data.products;
      const summary = {
        exact: 'Shop found Kai’s exact Gucci jacket.',
        similar: 'Shop couldn’t find Kai’s exact Gucci jacket. Here are similar jackets.',
        search: 'Live Shop results',
      }[data.match];
      this.results.replaceChildren(node('p', summary));
      for (const message of data.messages ?? []) {
        if (message.type === 'warning' && message.content) this.results.append(node('p', message.content));
      }
      if (!data.products.length) this.results.append(node('p', 'No available jackets matched. Try another search.'));
      const list = node('ol');
      for (const product of data.products) {
        const offer = product.variants.find((variant) => variant.availability?.available)!;
        const item = node('li');
        const title = link(product.title, offer.url) ?? node('strong', product.title);
        const select = node('button', 'Choose options');
        select.type = 'button';
        select.className = 'btn btn-sm btn-outline-cyan';
        select.onclick = () => {
          this.select(product, []);
          this.selectedPanel.scrollIntoView({ block: 'nearest' });
        };
        const media = (offer.media ?? product.media)?.find((asset) =>
          asset.type === 'image' && asset.url.startsWith('https://')
        );
        if (media) {
          const image = node('img');
          image.setAttribute('src', media.url);
          image.alt = media.alt_text ?? '';
          image.loading = 'lazy';
          item.append(image);
        }
        item.append(title, node('p', [offer.seller.name, money(offer.price.amount, offer.price.currency),
          ...(offer.options ?? []).map((option) => option.label)].join(' · ')), select);
        list.append(item);
      }
      this.results.append(list);
      return { summary, products: data.products.map((product, index) => ({
        number: index + 1, title: product.title, options: product.options,
        price: product.variants.find((variant) => variant.availability?.available)?.price,
      })) };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Live Shop search failed.';
      if (!request.signal.aborted) this.results.replaceChildren(node('p', message));
      return { error: request.signal.aborted ? 'Search replaced.' : message };
    }
  }

  private select(product: ShopProduct, suggested: Selection[]) {
    const session = this.session;
    if (!session || session.signal.aborted) return { error: 'The jacket panel is closed.' };
    const form = node('form');
    const status = node('p');
    status.setAttribute('role', 'status');
    const controls = new Map<string, HTMLSelectElement>();
    const initial: Selection[] = [];
    const unavailableOptions: Selection[] = [];
    form.append(node('strong', product.title));
    for (const option of product.options ?? []) {
      if (!option.values.length) continue;
      const label = node('label', option.name);
      const select = node('select');
      select.required = true;
      const placeholder = node('option', `Choose ${option.name.toLowerCase()}`);
      placeholder.value = '';
      select.append(placeholder);
      for (const value of option.values) {
        const choice = node('option', value.label);
        choice.value = value.label;
        select.append(choice);
      }
      const request = suggested.find((choice) =>
        typeof choice?.name === 'string' && typeof choice.label === 'string' &&
        choice.name.toLowerCase() === option.name.toLowerCase()
      );
      const match = request && option.values.find((value) =>
        value.label.toLowerCase() === request.label.toLowerCase()
      );
      if (request && !match) unavailableOptions.push({ name: option.name, label: request.label });
      select.value = match?.label ?? (!request && option.values.length === 1 ? option.values[0].label : '');
      if (select.value) initial.push({ name: option.name, label: select.value });
      controls.set(option.name, select);
      label.append(select);
      form.append(label);
    }
    const checkout = node('button', 'Prepare merchant checkout');
    checkout.className = 'btn btn-sm btn-primary';
    form.append(checkout, status);
    let key = crypto.randomUUID();
    form.onchange = () => {
      key = crypto.randomUUID();
      status.replaceChildren();
    };
    const prepareCheckout = async () => {
      if (checkout.disabled) return { error: 'Checkout is already being prepared.' };
      if (!form.reportValidity()) return { error: 'Choose all required options before checkout.' };
      const selected = [...controls].map(([name, select]) => ({ name, label: select.value }));
      checkout.disabled = true;
      controls.forEach((select) => { select.disabled = true; });
      status.textContent = 'Preparing checkout…';
      try {
        const data = await json<Checkout>('/api/jacket/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: product.id, selected, key }),
          signal: session.signal,
        });
        if (session.signal.aborted || !form.isConnected) return { error: 'The selection changed.' };
        const pay = link('Review and pay on merchant site ↗', data.continue_url);
        if (!pay) throw new Error('The merchant did not provide a checkout link.');
        status.textContent = '';
        for (const total of data.totals ?? []) {
          if (data.currency && typeof total.amount === 'number') {
            status.append(node('span', `${total.display_text || total.type}: ${money(total.amount, data.currency)}`));
          }
        }
        for (const message of data.messages ?? []) {
          if (message.content) status.append(node('span', message.content));
        }
        for (const policy of data.links ?? []) {
          const policyLink = link(policy.title || policy.type, policy.url);
          if (policyLink) status.append(policyLink);
        }
        pay.onclick = () => {
          if (this.voiceActive) this.voiceButton.click();
        };
        status.append(pay);
        return { message: 'Merchant checkout is ready. Ask the shopper to open the review and pay link.', currency: data.currency, totals: data.totals };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Checkout failed.';
        if (!session.signal.aborted) status.textContent = message;
        return { error: message };
      } finally {
        checkout.disabled = false;
        controls.forEach((select) => { select.disabled = false; });
      }
    };
    form.onsubmit = (event) => {
      event.preventDefault();
      void prepareCheckout();
    };
    this.prepareCheckout = prepareCheckout;
    this.selectedPanel.replaceChildren(form);
    return {
      selected: product.title,
      options: initial,
      unavailableOptions,
      missingOptions: [...controls].filter(([, select]) => !select.value).map(([name]) => name),
    };
  }
}
