import { useState } from "react";
import { AppNav, type Page } from "@/components/app-nav";
import { AboutPage } from "@/pages/about-page";
import { DataPage } from "@/pages/data-page";
import { PlaceholderPage } from "@/pages/placeholder-page";
import { SettingsPage } from "@/pages/settings-page";

export default function App() {
  const [page, setPage] = useState<Page>("calendar");

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <AppNav page={page} onNavigate={setPage} />
      <main className="min-h-0 flex-1 overflow-auto">
        {page === "data" ? (
          <DataPage />
        ) : page === "settings" ? (
          <SettingsPage />
        ) : page === "about" ? (
          <AboutPage />
        ) : (
          <PlaceholderPage page={page} />
        )}
      </main>
    </div>
  );
}
