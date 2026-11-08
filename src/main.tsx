import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import App from "./App";
import { I18nProvider } from "@/lib/i18n";
import { Toaster } from "@/components/ui/sonner";
import "./index.css";

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
