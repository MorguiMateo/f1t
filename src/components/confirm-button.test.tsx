import type { MouseEvent, SyntheticEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// This project has no DOM test runtime. Exercise the component's actual handlers
// and modal lifecycle with hooks and native dialog/focus methods controlled here.
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => void>,
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = value; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useId: () => "confirmation-test",
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined;
    if (previous && previous.deps.length === deps.length && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
    hooks.effects.push(() => {
      previous?.cleanup?.();
      const cleanup = effect();
      hooks.slots[index] = { deps, cleanup };
    });
  },
}));

import { ConfirmButton } from "./confirm-button";

type Props = Parameters<typeof ConfirmButton>[0];
const modal = { open: false, showModal: vi.fn(() => { modal.open = true; }), close: vi.fn(() => { modal.open = false; }) };
const heading = { setAttribute: vi.fn(), focus: vi.fn() };
const trigger = { isConnected: true, focus: vi.fn(), ownerDocument: { querySelector: vi.fn(() => heading) } };
const cancel = { focus: vi.fn() };

function render(props: Props) {
  hooks.cursor = 0;
  const tree = ConfirmButton(props);
  const [opener, dialog] = tree.props.children;
  dialog.props.ref.current = modal;
  const controls = dialog.props.children[2].props.children;
  controls[0].props.ref.current = cancel;
  hooks.effects.splice(0).forEach((effect) => effect());
  return {
    open: () => opener.props.onClick({ currentTarget: trigger } as unknown as MouseEvent<HTMLButtonElement>),
    cancel: () => controls[0].props.onClick(),
    confirm: () => controls[1].props.onClick(),
    escape: () => dialog.props.onCancel({ preventDefault: vi.fn() } as unknown as SyntheticEvent<HTMLDialogElement>),
    dialog,
  };
}

beforeEach(() => {
  hooks.slots = []; hooks.effects = []; hooks.cursor = 0;
  modal.open = false; trigger.isConnected = true;
  vi.clearAllMocks();
});

describe("explicit destructive confirmation", () => {
  it("does not perform the action on opening or cancelling and restores focus", () => {
    const props = { label: "Borrar", confirmLabel: "Borrar registro", onConfirm: vi.fn(), description: "Se borrará el peso del 10 de octubre." };
    render(props).open();
    const ui = render(props);
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(modal.showModal).toHaveBeenCalledTimes(1);
    expect(cancel.focus).toHaveBeenCalledTimes(1);
    expect(ui.dialog.props["aria-labelledby"]).toBe("confirmation-test-title");
    expect(ui.dialog.props["aria-describedby"]).toBe("confirmation-test-description");
    expect(ui.dialog.props.children[1].props.children).toBe(props.description);
    ui.cancel(); render(props);
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(modal.close).toHaveBeenCalled();
    expect(trigger.focus).toHaveBeenCalled();
  });
  it("Escape cancels rather than confirming", () => {
    const props = { label: "Sacar día", confirmLabel: "Sacar día", onConfirm: vi.fn() };
    render(props).open(); render(props).escape(); render(props);
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(modal.open).toBe(false);
  });
  it("requires an explicit confirm, stays available without a timer and suppresses a double click", () => {
    vi.useFakeTimers();
    try {
      const props = { label: "Borrar", confirmLabel: "Confirmar", onConfirm: vi.fn() };
      render(props).open(); const ui = render(props);
      vi.advanceTimersByTime(60_000);
      expect(modal.open).toBe(true);
      expect(props.onConfirm).not.toHaveBeenCalled();
      ui.confirm(); ui.confirm(); render(props);
      expect(props.onConfirm).toHaveBeenCalledTimes(1);
      expect(modal.open).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it("cannot confirm when permission to act becomes disabled while the dialog is open", () => {
    const onConfirm = vi.fn();
    const props = { label: "Borrar", confirmLabel: "Confirmar", onConfirm };
    render(props).open(); render(props);
    render({ ...props, disabled: true }).confirm(); render({ ...props, disabled: true });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(modal.open).toBe(false);
  });
  it("focuses the current screen heading if the deleted row removed its trigger", () => {
    const props = { label: "Borrar", confirmLabel: "Confirmar", onConfirm: () => { trigger.isConnected = false; } };
    render(props).open(); render(props).confirm(); render(props);
    expect(trigger.focus).not.toHaveBeenCalled();
    expect(heading.setAttribute).toHaveBeenCalledWith("tabindex", "-1");
    expect(heading.focus).toHaveBeenCalledTimes(1);
  });
});
