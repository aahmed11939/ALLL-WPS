import { UnitSystemProvider } from "./contexts/UnitSystemContext";
import { ProjectProvider } from "./contexts/ProjectContext";
import WizardPage from "./pages/WizardPage";

export default function App() {
  return (
    <UnitSystemProvider>
      <ProjectProvider>
        <WizardPage />
      </ProjectProvider>
    </UnitSystemProvider>
  );
}
