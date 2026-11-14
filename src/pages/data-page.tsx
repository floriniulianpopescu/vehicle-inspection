import { useEffect, useState } from "react";
import { SearchIcon } from "lucide-react";
import { CarsTab } from "@/components/data/cars-tab";
import { ClientsTab } from "@/components/data/clients-tab";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n";

const SEARCH_DELAY_MS = 200;

// forceMount keeps each tab's filters and result count while another is open.
const PANEL_CLASS = "data-[state=inactive]:hidden";

export function DataPage() {
  const { t } = useI18n();
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [cars, setCars] = useState(0);
  const [clients, setClients] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchText), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  // Any change can affect the other tab, e.g. saving a car links its clients.
  const shared = {
    search,
    refreshKey,
    onChanged: () => setRefreshKey((key) => key + 1),
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-6">
      <div className="relative">
        <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          value={searchText}
          placeholder={t.data.searchPlaceholder}
          aria-label={t.data.searchPlaceholder}
          onChange={(event) => setSearchText(event.target.value)}
        />
      </div>

      <Tabs defaultValue="cars">
        <TabsList>
          <TabsTrigger value="cars">
            {t.data.cars} <Badge variant="secondary">{cars}</Badge>
          </TabsTrigger>
          <TabsTrigger value="clients">
            {t.data.clients} <Badge variant="secondary">{clients}</Badge>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="cars" forceMount className={PANEL_CLASS}>
          <CarsTab {...shared} onTotal={setCars} />
        </TabsContent>
        <TabsContent value="clients" forceMount className={PANEL_CLASS}>
          <ClientsTab {...shared} onTotal={setClients} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
