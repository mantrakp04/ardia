import { showMenu, type MenuItem } from "../../platform/menus";

type ItemLook = Omit<Extract<MenuItem, { id: string }>, "id" | "children">;

export type ChoiceItem<T, Id extends string = string> =
  | { separator: true }
  | (ItemLook & { id: Id; children?: ChoiceItem<T, Id>[] })
  | (ItemLook & { value: T; children?: never });

const VALUE_ID = "value#";

export async function chooseFromMenu<T = never, Id extends string = never>(items: readonly ChoiceItem<T, Id>[]): Promise<T | Id | null> {
  const values = new Map<string, T>();
  const toMenu = (list: readonly ChoiceItem<T, Id>[]): MenuItem[] =>
    list.map((item) => {
      if ("separator" in item) return item;
      if ("value" in item) {
        const { value, ...look } = item;
        const id = `${VALUE_ID}${values.size}`;
        values.set(id, value);
        return { ...look, id };
      }
      const { children, ...look } = item;
      return children ? { ...look, children: toMenu(children) } : look;
    });
  const choice = await showMenu(toMenu(items));
  if (choice === null) return null;
  return values.has(choice) ? values.get(choice)! : (choice as Id);
}
