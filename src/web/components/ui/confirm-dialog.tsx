import { useRef } from "react";
import { AlertDialog } from "radix-ui";
import { Button } from "@/components/ui/button";
import { DialogFooter, DialogHeader } from "@/components/ui/dialog";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  action,
  onConfirm,
  returnFocusTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  action: string;
  onConfirm: () => void;
  returnFocusTo?: HTMLElement | null;
}) {
  const previousFocus = useRef<HTMLElement | null>(null);

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <AlertDialog.Content
          className="fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 gap-5 rounded-lg border bg-background p-6 shadow-lg outline-none"
          onOpenAutoFocus={() => {
            previousFocus.current = returnFocusTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            previousFocus.current?.focus();
          }}
        >
          <DialogHeader>
            <AlertDialog.Title className="font-display text-xl text-ink">{title}</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-muted-foreground break-words">{description}</AlertDialog.Description>
          </DialogHeader>
          <DialogFooter>
            <AlertDialog.Cancel asChild>
              <Button variant="outline">Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant="destructive" onClick={onConfirm}>{action}</Button>
            </AlertDialog.Action>
          </DialogFooter>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
