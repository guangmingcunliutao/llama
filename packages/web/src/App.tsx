import { useRoutes } from "react-router-dom";
import routes from "~react-pages";
import { RootLayout } from "./layouts/RootLayout";

export function App() {
  const element = useRoutes(routes);
  return <RootLayout>{element}</RootLayout>;
}
