import { UnitSystemProvider } from "./contexts/UnitSystemContext";
import DesignPage from "./pages/DesignPage";

export default function App() {
  return (
    <UnitSystemProvider>
      <DesignPage />
    </UnitSystemProvider>
  );
}
