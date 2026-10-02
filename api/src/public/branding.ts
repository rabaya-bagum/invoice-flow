import { optionOn, TEMPLATES, type DisplayOptionKey, type TemplateName } from '@invoiceflow/shared';

interface Branded {
  template: string;
  displayOptions: Record<string, boolean>;
}

/** The owner's template and on/off switches, as the customer pages apply them. */
export function pageBranding(biz: Branded) {
  const template: TemplateName = (TEMPLATES as readonly string[]).includes(biz.template)
    ? (biz.template as TemplateName)
    : 'classic';
  return {
    template,
    on: (key: DisplayOptionKey) => optionOn(biz.displayOptions, key),
  };
}

/** Extra CSS per template (the base stylesheet is the classic look). Static: no user input. */
export const TEMPLATE_CSS = `
body.t-modern .head{background:var(--accent);color:#fff}body.t-modern .head h1,body.t-modern .head .muted{color:#fff}
body.t-modern .head .badge{border-color:#fff;color:#fff}
body.t-minimal .badge{border-color:var(--ink);color:var(--ink)}body.t-minimal h1{color:var(--ink)}
body.t-minimal th{border-bottom:2px solid var(--ink);color:var(--ink)}body.t-minimal .card{border:1px solid var(--line)}
`;
