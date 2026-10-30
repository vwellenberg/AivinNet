import { defineStore } from "pinia";
import { NotifType } from "../enums";
import { Notif, NotifAction } from "../interfaces";

let nextNotifId = 1;

const useToast = defineStore("notification", {
  state: () => ({
    notifs: <Notif[]>[],
  }),
  actions: {
    /**
     * `durationMs` overrides the lifetime. It exists for toasts whose action has
     * a fixed window of its own (the queue undo, 6 s) — the action must not
     * outlive the toast carrying it, nor the other way round.
     */
    showNotification(new_text: string, new_type?: NotifType, action?: NotifAction, onClick?: () => void, durationMs?: number) {
      const id = nextNotifId++;
      this.notifs.push(<Notif>{
        id,
        text: new_text,
        type: new_type,
        action,
        onClick,
      });

      // Action and clickable toasts stay longer so the user can actually hit
      // them. Removal is id-based (not shift) since timeouts differ per toast.
      setTimeout(
        () => {
          this.notifs = this.notifs.filter((n) => n.id !== id);
        },
        durationMs ?? (action || onClick ? 8000 : 3000)
      );

      return id;
    },
    dismiss(id: number) {
      this.notifs = this.notifs.filter((n) => n.id !== id);
    },
    showError(text: string) {
      this.showNotification(text, NotifType.Error);
    },
    showSuccess(text: string){
      this.showNotification(text, NotifType.Success);
    },
    showGenericError(){
      this.showError("Failed! Something went wrong!")
    }
  },
});

class Notification {
  /** For `useToast().dismiss()`: an action toast whose action has lapsed must not keep offering it. */
  readonly id: number;

  constructor(text: string, type: NotifType = NotifType.Info, action?: NotifAction, onClick?: () => void) {
    this.id = useToast().showNotification(text, type, action, onClick);
  }
}

export { NotifType, Notification, useToast };
