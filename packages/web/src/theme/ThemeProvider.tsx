import { BgColorsOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, ConfigProvider, Dropdown, theme as antdTheme, theme } from "antd";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "model-training-theme";

type ThemeCtx = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
};

const Ctx = createContext<ThemeCtx | null>(null);

function systemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
    return "system";
  });
  const [prefersDark, setPrefersDark] = useState(systemDark);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setPrefersDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  const isDark = mode === "dark" || (mode === "system" && prefersDark);
  const algorithm = isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm;
  const value = useMemo(() => ({ mode, setMode }), [mode]);

  return (
    <Ctx.Provider value={value}>
      <ConfigProvider
        theme={{
          algorithm,
          cssVar: true,
          token: { borderRadius: 8, colorPrimary: "#1677ff" },
          components: {
            Layout: {
              siderBg: "#000000",
              triggerBg: "#000000",
              headerBg: isDark ? "#141414" : "#ffffff",
              bodyBg: isDark ? "#0f0f0f" : "#f5f5f5",
            },
            Card: {
              headerHeight: 40,
            },
            Menu: {
              darkItemBg: "#000000",
              darkSubMenuItemBg: "#000000",
              darkItemSelectedBg: "#1f1f1f",
              darkItemHoverBg: "#141414",
            },
          },
        }}
      >
        <AntdApp className="ant-app" style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
          {children}
        </AntdApp>
      </ConfigProvider>
    </Ctx.Provider>
  );
}

export function useThemeMode(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useThemeMode 必须在 ThemeProvider 内");
  return ctx;
}

export function AppearanceButton() {
  const { token } = theme.useToken();
  const { mode, setMode } = useThemeMode();
  return (
    <Dropdown
      menu={{
        selectable: true,
        selectedKeys: [mode],
        items: [
          { key: "light", label: "浅色" },
          { key: "dark", label: "深色" },
          { key: "system", label: "跟随系统" },
        ],
        onClick: ({ key }) => setMode(key as ThemeMode),
      }}
      placement="bottomRight"
    >
      <Button type="text" icon={<BgColorsOutlined />} title="外观" style={{ color: token.colorText }} />
    </Dropdown>
  );
}
