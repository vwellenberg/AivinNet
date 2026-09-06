import { defineStore } from "pinia";
import { NotifType } from "../enums";
import { Notif, NotifAction } from "../interfaces";

let nextNotifId = 1;

const useToast = defineStore("notification", {
  state: () => ({
    notifs: <Notif[]>[],
  }),
  actions: {
    showNotification(new_text: string, new_type?: NotifType, action?: NotifAction) {
      const id = nextNotifId++;
      this.notifs.push(<Notif>{
        id,
        text: new_text,
        type: new_type,
        action,
      });

      // Action toasts stay longer so the user can actually hit the button.
      // Removal is id-based (not shift) since timeouts differ per toast.
      setTimeout(
        () => {
          this.notifs = this.notifs.filter((n) => n.id !== id);
        },
        action ? 8000 : 3000
      );
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
  constructor(text: string, type: NotifType = NotifType.Info, action?: NotifAction) {
    useToast().showNotification(text, type, action);
  }
}

export { NotifType, Notification, useToast };
