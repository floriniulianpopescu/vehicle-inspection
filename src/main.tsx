import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import App from "./App";
import { I18nProvider } from "@/lib/i18n";
import { Toaster } from "@/components/ui/sonner";
import { applyUiScale, loadUiScale } from "@/lib/ui-scale";
import "./index.css";

applyUiScale(loadUiScale());

// The calendar and its settings were removed; drop what an older version saved.
try {
  localStorage.removeItem("calendar-settings");
} catch {
  // Nothing to clean up.
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
			<I18nProvider>
				<App />
				<Toaster />
			</I18nProvider>
		</ThemeProvider>
	</React.StrictMode>,
);
