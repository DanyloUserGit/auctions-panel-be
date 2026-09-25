// Правила контролю дій для сторінки (вкладки) конкретного користувача (ТЗ 8).

export interface ClientRules {
  forbiddenRoutes: string[];
  forbiddenSelectors: string[];
  // Список дозволених сторінок (ТЗ 8 п. 3): якщо не порожній, дозволено лише їх і головну сторінку аукціону.
  allowedRoutes?: string[];
}

export const EMPTY_RULES: ClientRules = { forbiddenRoutes: [], forbiddenSelectors: [], allowedRoutes: [] };

// Чи підпадає адреса під заборонений перехід. Формати правила:
//   https://site.com/en-es/_orders/  - ця сторінка та все, що нижче неї;
//   /_orders/                        - шлях (або його частина) на будь-якому домені аукціону;
//   *orders*, https://site.com/*/cart - шаблон, * - будь-які символи.
// Функція самодостатня (без зовнішніх змінних): її код вбудовується і в скрипт сторінки.
export function matchForbiddenUrl(target: string, pattern: string): boolean {
  const rule = (pattern || '').trim();
  if (!rule || rule === '/' || rule === '*') return false;

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  const hostPath = (url.hostname + url.pathname + url.search).replace(/\/+$/, '').toLowerCase();
  const pathOnly = (url.pathname + url.search).toLowerCase();
  const lower = rule.toLowerCase();

  if (lower.includes('*')) {
    const source = lower
      .replace(/^https?:\/\//, '')
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    const regex = new RegExp(`^${source.startsWith('/') ? '.*' : ''}${source}`);
    return regex.test(hostPath) || regex.test(pathOnly);
  }

  if (/^https?:\/\//.test(lower)) {
    try {
      const ruleUrl = new URL(lower);
      const ruleHostPath = (ruleUrl.hostname + ruleUrl.pathname + ruleUrl.search).replace(/\/+$/, '');
      return hostPath === ruleHostPath || hostPath.startsWith(`${ruleHostPath}/`) || hostPath.startsWith(`${ruleHostPath}?`);
    } catch {
      return false;
    }
  }

  return pathOnly.includes(lower);
}

export const isForbiddenUrl = (target: string, rules: ClientRules) =>
  rules.forbiddenRoutes.some((pattern) => matchForbiddenUrl(target, pattern));

const sameRoot = (a: string, b: string) => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.hostname === y.hostname && x.pathname.replace(/\/+$/, '') === y.pathname.replace(/\/+$/, '');
  } catch {
    return false;
  }
};

// Причина блокування переходу або null, якщо перехід дозволений.
export function navigationBlockReason(target: string, rules: ClientRules, homeUrl: string): string | null {
  if (isForbiddenUrl(target, rules)) return 'заборонений перехід';
  const allowed = rules.allowedRoutes ?? [];
  if (allowed.length && !sameRoot(target, homeUrl) && !allowed.some((pattern) => matchForbiddenUrl(target, pattern))) {
    return 'сторінка поза списком дозволених';
  }
  return null;
}

// Скрипт, що виконується в кожному документі сторінки користувача:
//  - блокує заборонені елементи (CSS-селектори) і заборонені посилання / переходи History API;
//  - посилання «в новій вкладці» та window.open відкриває в цій самій вкладці (транслюється одна вкладка);
//  - повідомляє Node про кожне натискання, введення та заборонену дію (window.__pwReport).
export function buildPageScript(rules: ClientRules, homeUrl: string): string {
  const body = (config: ClientRules & { homeUrl: string }, match: (target: string, pattern: string) => boolean) => {
    const w = window as any;
    if (w.__pwRulesInstalled) return;
    w.__pwRulesInstalled = true;

    const report = (kind: string, details: string) => {
      try {
        w.__pwReport?.(kind, details, window.location.href);
      } catch {
        /* Node недоступний - нічого не робимо */
      }
    };
    const isForbidden = (href: string) => {
      try {
        const absolute = new URL(href, window.location.href);
        if (config.forbiddenRoutes.some((p) => match(absolute.href, p))) return true;
        const allowed = config.allowedRoutes ?? [];
        if (!allowed.length) return false;
        const home = new URL(config.homeUrl);
        const isHome = absolute.hostname === home.hostname && absolute.pathname.replace(/\/+$/, '') === home.pathname.replace(/\/+$/, '');
        return !isHome && !allowed.some((p) => match(absolute.href, p));
      } catch {
        return false;
      }
    };

    // Опис елемента з ідентифікатором (ТЗ 9: «натискання кнопки з її ідентифікатором»).
    const describe = (el: Element | null): string => {
      if (!el) return 'невідомий елемент';
      const parts = [`<${el.tagName.toLowerCase()}>`];
      if (el.id) parts.push(`#${el.id}`);
      const name = el.getAttribute('name');
      if (name) parts.push(`name="${name}"`);
      const aria = el.getAttribute('aria-label') || el.getAttribute('title');
      if (aria) parts.push(`«${aria.slice(0, 60)}»`);
      const text = ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) parts.push(`«${text.slice(0, 60)}»`);
      if (!el.id && !name) {
        const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
        if (cls) parts.push(`.${cls}`);
      }
      return parts.join(' ');
    };

    const forbiddenElement = (target: EventTarget | null): Element | null => {
      if (!(target instanceof Element)) return null;
      for (const selector of config.forbiddenSelectors) {
        try {
          const hit = target.closest(selector);
          if (hit) return hit;
        } catch {
          /* некоректний селектор ігнорується */
        }
      }
      return null;
    };

    const blockForbiddenElement = (e: Event) => {
      const hit = forbiddenElement(e.target);
      if (!hit) return false;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === 'click' || (e.type === 'keydown' && (e as KeyboardEvent).key === 'Enter')) {
        report('forbidden_element', describe(hit));
      }
      return true;
    };
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'keydown', 'keyup', 'submit']) {
      window.addEventListener(type, blockForbiddenElement, true);
    }

    window.addEventListener(
      'click',
      (e) => {
        if (blockForbiddenElement(e)) return;
        const target = e.target instanceof Element ? e.target : null;
        const link = target?.closest('a[href]') as HTMLAnchorElement | null;
        if (link) {
          const raw = link.getAttribute('href') || '';
          if (!raw.startsWith('#') && !raw.startsWith('javascript:') && isForbidden(link.href)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            report('forbidden_link', link.href);
            return;
          }
          // Транслюється одна вкладка браузера: посилання «в новій вкладці» відкриваються тут же.
          if (link.target && link.target !== '_self') link.target = '_self';
        }
        const clickable = target?.closest('button, a, input, select, textarea, label, [role="button"], [onclick], [tabindex]') || target;
        report('click', describe(clickable));
      },
      true,
    );

    document.addEventListener(
      'change',
      (e) => {
        const el = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
        if (!el || !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
        const type = (el as HTMLInputElement).type;
        if (type === 'password' || type === 'hidden') return; // секрети не логуються
        const value = type === 'checkbox' || type === 'radio' ? String((el as HTMLInputElement).checked) : el.value;
        report('input', `${describe(el)} = "${String(value).slice(0, 200)}"`);
      },
      true,
    );

    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method];
      history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
        const url = args[2];
        if (url && isForbidden(String(url))) {
          report('forbidden_link', new URL(String(url), window.location.href).href);
          return;
        }
        return original.apply(this, args);
      } as History['pushState'];
    }

    w.open = (url?: string | URL) => {
      if (!url) return null;
      const href = new URL(String(url), window.location.href).href;
      if (isForbidden(href)) {
        report('forbidden_link', href);
        return null;
      }
      window.location.href = href;
      return null;
    };

    if (config.forbiddenSelectors.length) {
      const addStyle = () => {
        const style = document.createElement('style');
        style.textContent = config.forbiddenSelectors
          .map((s) => `${s} { opacity: 0.5 !important; cursor: not-allowed !important; }`)
          .join('\n');
        (document.head || document.documentElement).appendChild(style);
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addStyle);
      else addStyle();
    }
  };

  return `(${body.toString()})(${JSON.stringify({ ...rules, homeUrl })}, ${matchForbiddenUrl.toString()});`;
}
