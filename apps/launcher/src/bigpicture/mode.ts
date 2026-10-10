/** Whether Big Picture is showing. Desktop mode's button opens it; Big Picture's settings close it. */
let open = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export const bigPictureMode = {
  isOpen: () => open,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

export function openBigPicture() {
  if (open) return;
  open = true;
  changed();
}

export function closeBigPicture() {
  if (!open) return;
  open = false;
  changed();
}
