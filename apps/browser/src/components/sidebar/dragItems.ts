import type { DragController } from "./dragController";
import type { Item } from "./dragModel";

export class DragItems {
  private readonly own = new Map<string, Item>();
  readonly controller: DragController;
  private live: boolean;

  constructor(controller: DragController, live: boolean) {
    this.controller = controller;
    this.live = live;
  }

  add(key: string, item: Item) {
    this.own.set(key, item);
    if (this.live) this.controller.items.set(key, item);
    return () => {
      if (this.own.get(key) === item) this.own.delete(key);
      this.withdraw(key, item);
    };
  }

  setLive(live: boolean) {
    if (this.live === live) return;
    this.live = live;
    for (const [key, item] of this.own) {
      if (live) {
        this.controller.items.set(key, item);
        continue;
      }
      if (this.controller.active) {
        item.gap.stopAnimation();
        item.gap.setValue(0);
      }
      this.withdraw(key, item);
    }
  }

  private withdraw(key: string, item: Item) {
    if (this.controller.items.get(key) === item) this.controller.items.delete(key);
  }
}
