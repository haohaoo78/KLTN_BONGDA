import { createContext, FormEvent, ReactNode, useContext, useRef, useState } from "react";
import { Modal } from "./Modal";

type DialogOptions = { title: string; description: string; confirmLabel?: string; danger?: boolean };
type PromptOptions = DialogOptions & { label: string; placeholder?: string; required?: boolean };
type DialogState = (DialogOptions & { kind: "confirm" }) | (PromptOptions & { kind: "prompt" });
type DialogApi = { confirm: (options: DialogOptions) => Promise<boolean>; prompt: (options: PromptOptions) => Promise<string | null> };
const DialogContext = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const value = useContext(DialogContext);
  if (!value) throw new Error("useDialog must be used within DialogProvider");
  return value;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [input, setInput] = useState("");
  const resolver = useRef<((value: boolean | string | null) => void) | null>(null);

  function open(next: DialogState): Promise<boolean | string | null> {
    if (resolver.current) return Promise.resolve(next.kind === "confirm" ? false : null);
    setInput("");
    setDialog(next);
    return new Promise((resolve) => { resolver.current = resolve; });
  }

  function finish(value: boolean | string | null) {
    const resolve = resolver.current;
    resolver.current = null;
    setDialog(null);
    setInput("");
    resolve?.(value);
  }

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dialog?.kind !== "prompt") return;
    const value = input.trim();
    if (dialog.required !== false && !value) return;
    finish(value);
  }

  const api: DialogApi = {
    confirm: async (options) => await open({ ...options, kind: "confirm" }) === true,
    prompt: async (options) => {
      const result = await open({ ...options, kind: "prompt" });
      return typeof result === "string" ? result : null;
    },
  };

  return <DialogContext.Provider value={api}>
    {children}
    <Modal open={Boolean(dialog)} title={dialog?.title ?? "Xác nhận thao tác"} description={dialog?.description} onClose={() => finish(dialog?.kind === "confirm" ? false : null)} className="confirm-dialog">
      {dialog?.kind === "prompt" ? <form className="confirm-dialog-content" onSubmit={submitPrompt}>
        <label className="field">{dialog.label}<textarea autoFocus value={input} onChange={(event) => setInput(event.target.value)} placeholder={dialog.placeholder ?? "Nhập nội dung…"} rows={3} required={dialog.required !== false} /></label>
        <div className="modal-actions"><button type="button" className="button-secondary" onClick={() => finish(null)}>Hủy</button><button type="submit" className={dialog.danger ? "danger-button" : "primary-button"}>{dialog.confirmLabel ?? "Xác nhận"}</button></div>
      </form> : <div className="confirm-dialog-content"><div className="modal-actions"><button type="button" className="button-secondary" onClick={() => finish(false)}>Hủy</button><button type="button" className={dialog?.danger ? "danger-button" : "primary-button"} onClick={() => finish(true)}>{dialog?.confirmLabel ?? "Xác nhận"}</button></div></div>}
    </Modal>
  </DialogContext.Provider>;
}
