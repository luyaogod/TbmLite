import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import App from "./App.tsx";
import "./index.css";

// 阻止 Electron 窗口因文件拖放到页面空白处而跳转到该文件（拖拽上传依赖此行为）
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => event.preventDefault());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
    >
      <TooltipProvider delayDuration={300}>
        <App />
        <Toaster position="top-center" closeButton />
      </TooltipProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
