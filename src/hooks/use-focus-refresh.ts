import { useEffect, useState } from "react";

/**
 * A number that goes up each time the app window comes back into focus, for reloading data
 * that may have changed meanwhile (in another tab of the app, or by a send that finished).
 */
export function useFocusRefresh(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const bump = () => {
      if (document.visibilityState === "visible") setCount((value) => value + 1);
    };
    window.addEventListener("focus", bump);
    document.addEventListener("visibilitychange", bump);
    return () => {
      window.removeEventListener("focus", bump);
      document.removeEventListener("visibilitychange", bump);
    };
  }, []);
  return count;
}
