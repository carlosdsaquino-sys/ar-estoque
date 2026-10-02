const stack: { token: symbol; priority: number }[] = [];
let previousOverflow = '';
export function activateOverlay(priority = 80): symbol {
  if (!stack.length) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
  const token = Symbol('overlay'); stack.push({token, priority}); stack.sort((a,b) => a.priority - b.priority); return token;
}
export const isTopOverlay = (token: symbol) => stack[stack.length - 1]?.token === token;
export function releaseOverlay(token: symbol) {
  const index = stack.findIndex(entry => entry.token === token); if (index < 0) return;
  stack.splice(index, 1); if (!stack.length) document.body.style.overflow = previousOverflow;
}
