import { createContext, useContext, useState, type ReactNode } from "react";
import type { UnitSystem } from "../utils/units";

interface UnitSystemContextType {
  unitSystem: UnitSystem;
  setUnitSystem: (s: UnitSystem) => void;
  showBoth: boolean;
  setShowBoth: (b: boolean) => void;
}

const UnitSystemContext = createContext<UnitSystemContextType>({
  unitSystem: "SI",
  setUnitSystem: () => {},
  showBoth: false,
  setShowBoth: () => {},
});

export function UnitSystemProvider({ children }: { children: ReactNode }) {
  const [unitSystem, setUnitSystemState] = useState<UnitSystem>(() => {
    try {
      const stored = localStorage.getItem("wps_unitSystem");
      return stored === "US" ? "US" : "SI";
    } catch {
      return "SI";
    }
  });

  const [showBoth, setShowBothState] = useState<boolean>(() => {
    try {
      return localStorage.getItem("wps_showBoth") === "true";
    } catch {
      return false;
    }
  });

  const setUnitSystem = (s: UnitSystem) => {
    setUnitSystemState(s);
    try { localStorage.setItem("wps_unitSystem", s); } catch { /* ignore */ }
  };

  const setShowBoth = (b: boolean) => {
    setShowBothState(b);
    try { localStorage.setItem("wps_showBoth", String(b)); } catch { /* ignore */ }
  };

  return (
    <UnitSystemContext.Provider value={{ unitSystem, setUnitSystem, showBoth, setShowBoth }}>
      {children}
    </UnitSystemContext.Provider>
  );
}

export function useUnitSystem() {
  return useContext(UnitSystemContext);
}
