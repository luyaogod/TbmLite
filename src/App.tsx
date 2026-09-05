import { createHashRouter, Navigate, RouterProvider } from "react-router-dom";
import { AppShell } from "./components/layout/app-shell";
import { ProjectsPage } from "./pages/projects-page";
import { RequirementsPage } from "./pages/requirements-page";
import { RequirementDetailPage } from "./pages/requirement-detail-page";
import { AiSearchPage } from "./pages/ai-search-page";
import { SettingsPage } from "./pages/settings-page";

const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/projects", element: <ProjectsPage /> },
      { path: "/requirements", element: <RequirementsPage /> },
      { path: "/requirements/:pj/:req", element: <RequirementDetailPage /> },
      { path: "/search", element: <AiSearchPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { index: true, element: <Navigate to="/projects" replace /> },
      { path: "*", element: <Navigate to="/projects" replace /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
