import { useRef, useState } from "react";
import { UnitSystemProvider } from "../contexts/UnitSystemContext";
import { ProjectProvider } from "../contexts/ProjectContext";
import WizardPage from "./WizardPage";
import ProjectsPage from "./ProjectsPage";
import type { ProjectLoadResponse } from "../utils/api";

type View = "projects" | "wizard";
type WizardMode = "resume" | "new" | "open" | "import";

export default function MainApp() {
  const [view, setView] = useState<View>("projects");
  const [wizardMode, setWizardMode] = useState<WizardMode>("resume");
  const pendingProjectRef = useRef<ProjectLoadResponse | null>(null);
  const importTriggerRef = useRef<(() => void) | null>(null);

  const handleOpenProject = (row: ProjectLoadResponse) => {
    pendingProjectRef.current = row;
    setWizardMode("open");
    setView("wizard");
  };

  const handleNewProject = () => {
    pendingProjectRef.current = null;
    setWizardMode("new");
    setView("wizard");
  };

  const handleImportJSON = () => {
    pendingProjectRef.current = null;
    setWizardMode("import");
    setView("wizard");
    setTimeout(() => {
      importTriggerRef.current?.();
    }, 150);
  };

  return (
    <UnitSystemProvider>
      <ProjectProvider>
        {view === "projects" ? (
          <ProjectsPage
            onOpenProject={handleOpenProject}
            onNewProject={handleNewProject}
            onImportJSON={handleImportJSON}
          />
        ) : (
          <WizardPage
            pendingProject={pendingProjectRef.current}
            wizardMode={wizardMode}
            onGoToLanding={() => setView("projects")}
            importTriggerRef={importTriggerRef}
          />
        )}
      </ProjectProvider>
    </UnitSystemProvider>
  );
}
