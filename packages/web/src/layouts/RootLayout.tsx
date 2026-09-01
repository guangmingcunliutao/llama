/**
 * 后台壳：左侧菜单 + 顶栏固定，只有右侧内容区滚动。
 * 菜单项来自 pages 的 `export const menu`，不要在这里手写路由。
 */
import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import type { MenuProps } from "antd";
import { Button, Layout, Menu, Space, Tag } from "antd";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { JobProvider, useJob } from "../jobs/JobContext";
import { sidebarItems } from "../menu/fromPages";
import { BrandMark } from "../ui/BrandMark";
import { AppearanceButton, ThemeProvider } from "../theme/ThemeProvider";

const { Header, Sider, Content } = Layout;
const ITEMS = sidebarItems();

function selectedKeys(pathname: string, items: MenuProps["items"]): string[] {
  if (pathname === "/") return ["/"];
  const hit = items?.find(
    (item) => item && "key" in item && item.key !== "/" && pathname.startsWith(String(item.key)),
  );
  return hit && "key" in hit ? [String(hit.key)] : ["/"];
}

function pageTitle(pathname: string): string {
  const keys = selectedKeys(pathname, ITEMS);
  const hit = ITEMS.find((item) => item && "key" in item && item.key === keys[0]);
  if (hit && "label" in hit) return String(hit.label);
  return "工作台";
}

function Shell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { job } = useJob();
  const [collapsed, setCollapsed] = useState(false);
  const selected = useMemo(() => selectedKeys(location.pathname, ITEMS), [location.pathname]);

  return (
    <Layout className="app-frame">
      <Sider
        className="app-sider"
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        width={220}
        breakpoint="lg"
      >
        <div className="app-brand">
          <div className="app-brand-mark">
            <BrandMark />
          </div>
          {collapsed ? null : (
            <div className="app-brand-text">
              <strong>模型训练</strong>
              <span>数据 · 训练 · 评估</span>
            </div>
          )}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={selected}
          items={ITEMS}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout className="app-main">
        <Header className="app-header">
          <Space>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((v) => !v)}
            />
            <span style={{ fontWeight: 600 }}>{pageTitle(location.pathname)}</span>
          </Space>
          <Space size={8}>
            <Tag color={job.busy ? "processing" : job.error ? "error" : "success"}>
              {job.busy ? job.job : job.error ? "失败" : "空闲"}
            </Tag>
            <AppearanceButton />
          </Space>
        </Header>
        <Content className="app-content">
          <div className="app-content-inner">{children}</div>
        </Content>
      </Layout>
    </Layout>
  );
}

export function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <JobProvider>
        <Shell>{children}</Shell>
      </JobProvider>
    </ThemeProvider>
  );
}
