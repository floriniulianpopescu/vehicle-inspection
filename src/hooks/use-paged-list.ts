import { useEffect, useState } from "react";
import { toast } from "sonner";
import { errorMessage, type Page } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/**
 * Loads one page of rows, and reloads when `filterKey` or `refreshKey` change.
 * A new `filterKey` also returns to the first page.
 */
export function usePagedList<T>(
  fetchPage: (page: number) => Promise<Page<T>>,
  filterKey: string,
  refreshKey: number,
) {
  const { t } = useI18n();
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Page<T>>({ rows: [], total: 0 });
  const [loadedKey, setLoadedKey] = useState(filterKey);

  if (loadedKey !== filterKey) {
    setLoadedKey(filterKey);
    setPage(0);
  }

  useEffect(() => {
    let stale = false;
    fetchPage(page)
      .then((result) => {
        if (stale) return;
        // Deleting the last row of the last page leaves that page empty.
        if (result.rows.length === 0 && page > 0) setPage(page - 1);
        else setData(result);
      })
      .catch((error) => {
        if (!stale) toast.error(errorMessage(t, error));
      });
    return () => {
      stale = true;
    };
    // fetchPage is rebuilt every render; filterKey captures what it depends on.
  }, [filterKey, refreshKey, page]);

  return { ...data, page, setPage };
}
