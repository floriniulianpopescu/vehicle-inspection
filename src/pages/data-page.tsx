import { useEffect, useState } from "react";
import { SearchIcon } from "lucide-react";
import { AppointmentsTab } from "@/components/data/appointments-tab";
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
  const [appointments, setAppointments] = useState(0);
  const [cars, setCars] = useState(0);
  const [clients, setClients] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchText), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  // Any change can affect another tab, e.g. a booking links a car and a client.
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

      <Tabs defaultValue="appointments">
        <TabsList>
          <TabsTrigger value="appointments">
            {t.data.appointments} <Badge variant="secondary">{appointments}</Badge>
          </TabsTrigger>
          <TabsTrigger value="cars">
            {t.data.cars} <Badge variant="secondary">{cars}</Badge>
          </TabsTrigger>
          <TabsTrigger value="clients">
            {t.data.clients} <Badge variant="secondary">{clients}</Badge>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="appointments" forceMount className={PANEL_CLASS}>
          <AppointmentsTab {...shared} onTotal={setAppointments} />
        </TabsContent>
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
