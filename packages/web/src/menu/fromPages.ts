/**
 * 按 pages 目录的 `export const menu` 生成侧栏。路由由文件名推导，不要在此写死 path。
 */
import type { MenuProps } from "antd";
import { createElement } from "react";
import { MENU_ICONS } from "./icons";
import { routeFromGlobKey } from "./routeFromGlob";

export interface PageMenuMeta {
  title: string;
  icon?: string;
  order?: number;
  hide?: boolean;
}

const modules = import.meta.glob<PageMenuMeta | undefined>("../pages/**/*.tsx", {
  eager: true,
  import: "menu",
});

export function sidebarItems(): NonNullable<MenuProps["items"]> {
  const rows = Object.entries(modules)
    .map(([file, menu]) => {
      if (!menu || menu.hide) return null;
      const Icon = menu.icon ? MENU_ICONS[menu.icon] : undefined;
      return {
        key: routeFromGlobKey(file),
        icon: Icon ? createElement(Icon) : undefined,
        label: menu.title,
        order: menu.order ?? 100,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item != null)
    .sort((a, b) => a.order - b.order || String(a.key).localeCompare(String(b.key)));

  return rows.map(({ order: _order, ...item }) => item);
}
