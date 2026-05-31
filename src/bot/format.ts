export function h(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function b(value: string): string {
  return `<b>${h(value)}</b>`;
}

export function code(value: string): string {
  return `<code>${h(value)}</code>`;
}

export function lines(parts: Array<string | undefined | false>): string {
  return parts.filter((part): part is string => Boolean(part)).join("\n");
}
